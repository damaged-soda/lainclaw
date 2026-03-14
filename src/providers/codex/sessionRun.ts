import type { AgentEvent, AgentMessage, AgentTool } from "@mariozechner/pi-agent-core";
import type { Message, Model, AssistantMessage } from "@mariozechner/pi-ai";
import { writeDebugLogIfEnabled } from "../../shared/debug.js";
import type {
  ContextToolSpec,
  RequestContext,
  RuntimeAgentEventSink,
} from "../../shared/types.js";
import { normalizePersistedMessages } from "../../sessions/agentSnapshotStore.js";
import {
  convertAgentMessagesToLlm,
  makeUserContextMessage,
  transformContextMessages,
} from "../../runtime/context.js";
import {
  reportLangfuseRuntimeFailure,
  runLangfuseOperationSafely,
  startActiveObservation,
} from "../../observability/langfuse.js";
import type { ProviderPreparedState, ProviderResult } from "../registry.js";
import { buildCodexDebugRequestSnapshot } from "../codexDebug.js";
import type { SessionAgentManager } from "../../runtime/sessionAgentManager.js";
import type { CodexAgentEventAccumulator } from "./agentEventAccumulator.js";
import { toText } from "./messageText.js";
import {
  addUsage,
  createEmptyUsage,
  hasUsage,
  toLangfuseCostDetails,
  toLangfuseUsageDetails,
} from "./usage.js";

export interface RunCodexSessionInput {
  sessionAgentManager: SessionAgentManager;
  requestContext: RequestContext;
  preparedState: ProviderPreparedState;
  systemPrompt: string;
  model: Model<any>;
  agentTools: AgentTool<any>[];
  toolSpecs: ContextToolSpec[];
  provider: string;
  profileId: string;
  route: string;
  modelName: string;
  withTools: boolean;
  tracingEnabled: boolean;
  apiKey: string;
  eventState: CodexAgentEventAccumulator;
  onAgentEvent?: RuntimeAgentEventSink;
}

export interface RunCodexSessionResult {
  runErr: Error | undefined;
  agentSource: "memory" | "snapshot" | "transcript" | "new";
  sessionState?: ProviderResult["sessionState"];
}

function isAssistantMessage(message: AgentMessage | Message | undefined): message is AssistantMessage {
  return Boolean(message && typeof message === "object" && "role" in message && message.role === "assistant");
}

function buildGenerationInput(systemPrompt: string, messages: Message[]) {
  return {
    systemPrompt,
    messages,
  };
}

export async function runCodexSession(input: RunCodexSessionInput): Promise<RunCodexSessionResult> {
  const {
    sessionAgentManager,
    requestContext,
    preparedState,
    systemPrompt,
    model,
    agentTools,
    toolSpecs,
    provider,
    profileId,
    route,
    modelName,
    withTools,
    tracingEnabled,
    apiKey,
    eventState,
  } = input;
  const requestId = requestContext.requestId;
  let runErr: Error | undefined;
  let agentSource: "memory" | "snapshot" | "transcript" | "new" = preparedState.source;
  let sessionState: ProviderResult["sessionState"] | undefined;
  let agentEventDispatch = Promise.resolve();

  const agentRun = await sessionAgentManager.run(
    {
      requestContext,
      systemPrompt,
      initialState: {
        source: preparedState.source,
        systemPrompt: preparedState.initialSystemPrompt ?? systemPrompt,
        messages: preparedState.initialMessages,
      },
      model,
      tools: agentTools,
      convertToLlm: (messages: AgentMessage[]) => convertAgentMessagesToLlm(messages),
      getApiKey: async () => apiKey,
      debug: requestContext.debug === true,
    },
    async (agent, context) => {
      agentSource = context.cache === "hit" ? "memory" : preparedState.source;
      const promptMessage = requestContext.runMode === "prompt"
        ? makeUserContextMessage(requestContext.input)
        : undefined;
      const requestMessages = requestContext.runMode === "prompt" && promptMessage
        ? [...normalizePersistedMessages(agent.state.messages), promptMessage]
        : normalizePersistedMessages(agent.state.messages);
      const transformedMessages = await transformContextMessages({
        requestContext,
        messages: requestMessages,
      });
      const llmMessages = convertAgentMessagesToLlm(transformedMessages);

      writeDebugLogIfEnabled(requestContext.debug, "provider.codex.run_selected", {
        requestId,
        sessionKey: requestContext.sessionKey,
        sessionId: requestContext.sessionId,
        provider,
        profileId,
        route,
        source: agentSource,
        requestedRunMode: requestContext.runMode,
        runMode: requestContext.runMode,
        continueReason: requestContext.continueReason,
      });

      writeDebugLogIfEnabled(requestContext.debug, "provider.codex.pi_agent_core_request", {
        requestId,
        sessionKey: requestContext.sessionKey,
        provider,
        profileId,
        route,
        withTools,
        runMode: requestContext.runMode,
        continueReason: requestContext.continueReason,
        transformedMessageCount: transformedMessages.length,
        request: buildCodexDebugRequestSnapshot({
          systemPrompt,
          modelName,
          messages: llmMessages,
          tools: toolSpecs,
          ...(promptMessage ? { prompt: promptMessage } : {}),
        }),
      });

      const executeAgentRun = async () => {
        if (requestContext.runMode === "continue") {
          await agent.continue();
        } else if (promptMessage) {
          await agent.prompt(promptMessage);
        } else {
          throw new Error("Prompt mode requires a user message.");
        }
      };

      const runWithSubscription = async (onEvent?: (event: AgentEvent) => void) => {
        const unsubscribe = agent.subscribe((event: AgentEvent) => {
          eventState.consume(event);
          onEvent?.(event);

          if (input.onAgentEvent) {
            const runtimeAgentEvent = {
              requestId,
              sessionKey: requestContext.sessionKey,
              sessionId: requestContext.sessionId,
              route,
              provider,
              profileId,
              event,
            };
            agentEventDispatch = agentEventDispatch
              .catch(() => undefined)
              .then(async () => {
                try {
                  await input.onAgentEvent?.(runtimeAgentEvent);
                } catch {
                  // Runtime event sinks are observational only.
                }
              });
          }
        });

        try {
          await executeAgentRun();
        } catch (error) {
          runErr = error instanceof Error ? error : new Error(String(error));
        } finally {
          unsubscribe();
          await agentEventDispatch;
        }
      };

      if (!tracingEnabled) {
        await runWithSubscription();
        return;
      }

      const generationInput = buildGenerationInput(systemPrompt, llmMessages);
      let generationRunStarted = false;
      try {
        await startActiveObservation(
          "openai-codex.run",
          async (generationObservation) => {
            const usage = createEmptyUsage();
            let completionStartTime: Date | undefined;
            let streamedOutput = "";
            let assistantMessageCount = 0;

            generationObservation.update({
              model: modelName,
              input: generationInput,
              metadata: {
                requestId,
                route,
                provider,
                profileId,
                source: agentSource,
                requestedRunMode: requestContext.runMode,
                runMode: requestContext.runMode,
                continueReason: requestContext.continueReason ?? "none",
                withTools,
                sessionId: requestContext.sessionId,
                sessionKey: requestContext.sessionKey,
              },
            });

            generationRunStarted = true;
            await runWithSubscription((event) => {
              if (event.type === "message_start" && isAssistantMessage(event.message) && !completionStartTime) {
                completionStartTime = new Date();
              }

              if (event.type === "message_update" && isAssistantMessage(event.message)) {
                if (!completionStartTime) {
                  completionStartTime = new Date();
                }
                const partialText = toText(event.message);
                if (partialText) {
                  streamedOutput = partialText;
                  runLangfuseOperationSafely(() => {
                    generationObservation.update({
                      ...(completionStartTime ? { completionStartTime } : {}),
                      output: streamedOutput,
                    });
                  }, "codex.generation.stream");
                }
              }

              if (event.type === "message_end" && isAssistantMessage(event.message)) {
                assistantMessageCount += 1;
                addUsage(usage, event.message.usage);
                const messageText = toText(event.message);
                if (messageText) {
                  streamedOutput = messageText;
                }
              }
            });

            const finalAssistant = eventState.finalMessage;
            const finalOutput = toText(finalAssistant);
            const resolvedOutput = finalOutput || streamedOutput;

            runLangfuseOperationSafely(() => {
              generationObservation.update({
                ...(completionStartTime ? { completionStartTime } : {}),
                ...(resolvedOutput ? { output: resolvedOutput } : {}),
                ...(finalAssistant && isAssistantMessage(finalAssistant)
                  ? { model: finalAssistant.model }
                  : {}),
                ...(hasUsage(usage)
                  ? {
                    usageDetails: toLangfuseUsageDetails(usage),
                    costDetails: toLangfuseCostDetails(usage),
                  }
                  : {}),
                metadata: {
                  requestId,
                  route,
                  provider,
                  profileId,
                  source: agentSource,
                  requestedRunMode: requestContext.runMode,
                  runMode: requestContext.runMode,
                  continueReason: requestContext.continueReason ?? "none",
                  withTools,
                  sessionId: requestContext.sessionId,
                  sessionKey: requestContext.sessionKey,
                  assistantMessageCount,
                  toolCallCount: eventState.toolCalls.length,
                  stopReason: eventState.stopReason ?? "unknown",
                },
                ...(runErr
                  ? {
                    level: "ERROR" as const,
                    statusMessage: runErr.message,
                  }
                  : {}),
              });
            }, "codex.generation.final");
          },
          { asType: "generation" },
        );
      } catch (error) {
        reportLangfuseRuntimeFailure("codex.generation", error);
        if (!generationRunStarted) {
          await runWithSubscription();
        }
      }
    },
  );
  agentSource = agentRun.cache === "hit" ? "memory" : preparedState.source;
  sessionState = agentRun.sessionState;

  return {
    runErr,
    agentSource,
    ...(sessionState ? { sessionState } : {}),
  };
}
