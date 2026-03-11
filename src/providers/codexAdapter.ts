import path from "node:path";
import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel, type AssistantMessage, type Message, type Usage } from "@mariozechner/pi-ai";
import { getOpenAICodexApiContext, OPENAI_CODEX_MODEL } from "../auth/authManager.js";
import type { ProviderRunInput } from "./registry.js";
import type { ProviderResult } from "./stubAdapter.js";
import type { ToolCall, ToolExecutionLog } from "../tools/types.js";
import { buildRuntimeToolNameMap, createToolAdapter, resolveTools } from "../tools/runtimeTools.js";
import { executeTool } from "../tools/executor.js";
import { createToolCallId } from "../shared/ids.js";
import { resolveBooleanFlag } from "../shared/envFlags.js";
import { toText } from "../providers/codex/messageText.js";
import { createCodexAgentEventAccumulator } from "../providers/codex/agentEventAccumulator.js";
import { writeDebugLogIfEnabled } from "../shared/debug.js";
import { buildCodexDebugRequestSnapshot } from "./codexDebug.js";
import {
  isLangfuseTracingReady,
  reportLangfuseRuntimeFailure,
  runLangfuseOperationSafely,
  startActiveObservation,
  startObservation,
} from "../observability/langfuse.js";
import {
  sessionAgentManager as defaultSessionAgentManager,
  type SessionAgentManager,
} from "../runtime/sessionAgentManager.js";
import { normalizePersistedMessages } from "../runtime/agentStateStore.js";
import {
  convertAgentMessagesToLlm,
  makeUserContextMessage,
  transformContextMessages,
} from "../runtime/context.js";

// 该系统提示词是 MVP 阶段的临时兜底：用于让 provider responses 在最小路径下可直接返回结果。
// 这是可替换配置，不是对外契约；后续接手时可按体验目标调整文案、样式或完全替换。
const OPENAI_CODEX_SYSTEM_PROMPT = "你是 Lainclaw，一个务实的 AI 助手。先做事，再解释。 用户让你检查、验证、排查、读取、抓取、总结时，默认先做最小且安全的动作，再根据结果继续，不要先长篇免责声明。 除非操作具有破坏性、不可逆、涉及隐私、会对外可见或可能花钱，否则不要先确认。 不要只谈能力边界；能安全尝试就先尝试一次，再基于真实输出回答。 保持简洁、具体、结果导向。";

interface AggregatedUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

function isAssistantMessage(message: AgentMessage | Message | undefined): message is AssistantMessage {
  return Boolean(message && typeof message === "object" && "role" in message && message.role === "assistant");
}

function createEmptyUsage(): AggregatedUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function addUsage(target: AggregatedUsage, usage: Usage | undefined): void {
  if (!usage) {
    return;
  }

  target.input += usage.input || 0;
  target.output += usage.output || 0;
  target.cacheRead += usage.cacheRead || 0;
  target.cacheWrite += usage.cacheWrite || 0;
  target.totalTokens += usage.totalTokens || 0;
  target.cost.input += usage.cost?.input || 0;
  target.cost.output += usage.cost?.output || 0;
  target.cost.cacheRead += usage.cost?.cacheRead || 0;
  target.cost.cacheWrite += usage.cost?.cacheWrite || 0;
  target.cost.total += usage.cost?.total || 0;
}

function hasUsage(usage: AggregatedUsage): boolean {
  return (
    usage.input > 0
    || usage.output > 0
    || usage.cacheRead > 0
    || usage.cacheWrite > 0
    || usage.totalTokens > 0
    || usage.cost.total > 0
  );
}

function toLangfuseUsageDetails(usage: AggregatedUsage): Record<string, number> {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: usage.totalTokens,
  };
}

function toLangfuseCostDetails(usage: AggregatedUsage): Record<string, number> {
  return {
    input: usage.cost.input,
    output: usage.cost.output,
    cacheRead: usage.cost.cacheRead,
    cacheWrite: usage.cost.cacheWrite,
    total: usage.cost.total,
  };
}

function buildGenerationInput(systemPrompt: string, messages: Message[]) {
  return {
    systemPrompt,
    messages,
  };
}

function buildToolObservationOutput(log: ToolExecutionLog): unknown {
  return {
    ok: log.result.ok,
    ...(log.result.content !== undefined ? { content: log.result.content } : {}),
    ...(log.result.error ? { error: log.result.error } : {}),
    ...(log.result.meta ? { meta: log.result.meta } : {}),
  };
}

function isAbortError(error: unknown): error is Error {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function getAdapterStage(route: string, profileId: string, hasFailure: boolean): string {
  return `${route}.${profileId}${hasFailure ? ".failed" : ""}`;
}

function shouldPrefixResponse(profileId: string, provider: string): string {
  if (!resolveBooleanFlag(process.env.LAINCLAW_CODEX_PREFIX_RESPONSE)) {
    return "";
  }
  return `[${provider}:${profileId}] `;
}

function normalizeProvider(raw: string): string {
  const normalized = (raw || "").trim();
  if (!normalized) {
    throw new Error("Missing provider. Set --provider in command args or runtime config.");
  }
  return normalized;
}

function buildToolErrorLog(toolCall: ToolCall, message: string): ToolExecutionLog {
  return {
    call: {
      ...toolCall,
      source: "agent-runtime",
    },
    result: {
      ok: false,
      error: {
        code: "execution_error",
        tool: toolCall.name,
        message,
      },
      meta: {
        tool: toolCall.name,
        durationMs: 0,
      },
    },
  };
}

interface CodexAdapterDependencies {
  sessionAgentManager?: SessionAgentManager;
  executeToolFn?: typeof executeTool;
  getApiContextFn?: typeof getOpenAICodexApiContext;
  getModelFn?: typeof getModel;
}

export function createRunCodexAdapter(
  dependencies: CodexAdapterDependencies = {},
): (input: ProviderRunInput) => Promise<ProviderResult> {
  const sessionAgentManager = dependencies.sessionAgentManager ?? defaultSessionAgentManager;
  const executeToolFn = dependencies.executeToolFn ?? executeTool;
  const getApiContextFn = dependencies.getApiContextFn ?? getOpenAICodexApiContext;
  const getModelFn = dependencies.getModelFn ?? getModel;

  return async function runCodexAdapter(input: ProviderRunInput): Promise<ProviderResult> {
    const provider = normalizeProvider(input.requestContext.provider);
    if (provider !== "openai-codex") {
      throw new Error(`Unsupported provider for openai runtime: ${provider}`);
    }

    const requestContext = input.requestContext;
    const requestId = requestContext.requestId;
    const toolSpecs = resolveTools(input.toolSpecs, input.withTools);
    const cwd = path.resolve(input.cwd || process.cwd());
    const tracingEnabled = isLangfuseTracingReady();
    const toolNameMap = buildRuntimeToolNameMap(toolSpecs);
    const canonicalByCodexName = toolNameMap.canonicalByCodex;
    const eventState = createCodexAgentEventAccumulator({
      provider,
      canonicalByCodexName,
    });

    const runTool = async (toolCall: ToolCall, signal?: AbortSignal): Promise<ToolExecutionLog> => {
      const resolvedCall: ToolCall = {
        ...toolCall,
        id: toolCall.id || createToolCallId(toolCall.name || "unknown"),
        source: "agent-runtime",
      };

      const startedAt = Date.now();
      try {
        const execution = await executeToolFn(resolvedCall, {
          requestId,
          sessionId: requestContext.sessionId,
          sessionKey: requestContext.sessionKey,
          cwd,
          signal,
        });
        const log: ToolExecutionLog = {
          call: {
            ...execution.call,
            id: resolvedCall.id,
          },
          result: {
            ...execution.result,
            meta: {
              ...execution.result.meta,
              tool: resolvedCall.name,
              durationMs: Math.max(1, Date.now() - startedAt),
            },
          },
        };
        if (tracingEnabled) {
          runLangfuseOperationSafely(() => {
            const toolObservation = startObservation(
              `tool.${resolvedCall.name}`,
              {
                input: resolvedCall.args,
                output: buildToolObservationOutput(log),
                metadata: {
                  requestId,
                  sessionId: requestContext.sessionId,
                  sessionKey: requestContext.sessionKey,
                  provider,
                  profileId: requestContext.profileId,
                  toolCallId: resolvedCall.id,
                  toolName: resolvedCall.name,
                },
                ...(log.result.ok ? {} : {
                  level: "ERROR" as const,
                  statusMessage: log.result.error?.message ?? `tool ${resolvedCall.name} failed`,
                }),
              },
              { asType: "tool" },
            );
            toolObservation.end();
          }, `tool.${resolvedCall.name}`);
        }
        return log;
      } catch (error) {
        const log = buildToolErrorLog(
          resolvedCall,
          error instanceof Error ? error.message : "tool execution failed",
        );
        if (tracingEnabled) {
          runLangfuseOperationSafely(() => {
            const toolObservation = startObservation(
              `tool.${resolvedCall.name}`,
              {
                input: resolvedCall.args,
                output: buildToolObservationOutput(log),
                metadata: {
                  requestId,
                  sessionId: requestContext.sessionId,
                  sessionKey: requestContext.sessionKey,
                  provider,
                  profileId: requestContext.profileId,
                  toolCallId: resolvedCall.id,
                  toolName: resolvedCall.name,
                },
                level: "ERROR",
                statusMessage: log.result.error?.message ?? `tool ${resolvedCall.name} failed`,
              },
              { asType: "tool" },
            );
            toolObservation.end();
          }, `tool.${resolvedCall.name}`);
        }
        return log;
      }
    };

    const agentTools = createToolAdapter(toolSpecs, runTool, toolNameMap);
    const { apiKey, profile } = await getApiContextFn(requestContext.profileId);
    const model = getModelFn(provider, OPENAI_CODEX_MODEL);
    if (!model) {
      throw new Error(`No model found: ${provider}/${OPENAI_CODEX_MODEL}`);
    }

    const profileId = profile.id;
    const systemPrompt = requestContext.systemPrompt ?? OPENAI_CODEX_SYSTEM_PROMPT;

    writeDebugLogIfEnabled(requestContext.debug, "provider.codex.system_prompt_attached", {
      requestId,
      sessionKey: requestContext.sessionKey,
      provider,
      profileId,
      source: requestContext.systemPrompt ? "request_context" : "default",
      systemPrompt,
    });

    let runErr: Error | undefined;
    let agentSource: "memory" | "snapshot" | "new" = "new";
    let runMode = requestContext.runMode;
    let continueReason = requestContext.continueReason;
    let agentEventDispatch = Promise.resolve();

    await sessionAgentManager.runWithSessionAgent(
      {
        requestContext,
        systemPrompt,
        model,
        tools: agentTools,
        convertToLlm: (messages: AgentMessage[]) => convertAgentMessagesToLlm(messages),
        getApiKey: async () => apiKey,
        debug: requestContext.debug === true,
      },
      async (agent, context) => {
        agentSource = context.source;
        runMode = context.runMode;
        continueReason = context.continueReason;
        const promptMessage = context.runMode === "prompt"
          ? makeUserContextMessage(requestContext.input)
          : undefined;
        const requestMessages = context.runMode === "prompt" && promptMessage
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
          route: input.route,
          source: agentSource,
          requestedRunMode: requestContext.runMode,
          runMode,
          continueReason,
          lastMessageRole: context.lastMessageRole,
        });

        writeDebugLogIfEnabled(requestContext.debug, "provider.codex.pi_agent_core_request", {
          requestId,
          sessionKey: requestContext.sessionKey,
          provider,
          profileId,
          route: input.route,
          withTools: input.withTools,
          runMode,
          continueReason,
          transformedMessageCount: transformedMessages.length,
          request: buildCodexDebugRequestSnapshot({
            systemPrompt,
            modelName: OPENAI_CODEX_MODEL,
            messages: llmMessages,
            tools: toolSpecs,
            ...(promptMessage ? { prompt: promptMessage } : {}),
          }),
        });

        const executeAgentRun = async () => {
          if (context.runMode === "continue") {
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
                route: input.route,
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
                model: OPENAI_CODEX_MODEL,
                input: generationInput,
                metadata: {
                  requestId,
                  route: input.route,
                  provider,
                  profileId,
                  source: agentSource,
                  requestedRunMode: requestContext.runMode,
                  runMode,
                  continueReason: continueReason ?? "none",
                  withTools: input.withTools,
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
                    route: input.route,
                    provider,
                    profileId,
                    source: agentSource,
                    requestedRunMode: requestContext.runMode,
                    runMode,
                    continueReason: continueReason ?? "none",
                    withTools: input.withTools,
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

    writeDebugLogIfEnabled(requestContext.debug, "provider.codex.agent_session_used", {
      requestId,
      sessionKey: requestContext.sessionKey,
      sessionId: requestContext.sessionId,
      provider,
      profileId,
      source: agentSource,
    });

    const primaryToolError = eventState.toolError;
    if (runErr && !primaryToolError && !isAbortError(runErr)) {
      throw runErr;
    }

    const failed = Boolean(runErr);
    const resolvedFinalMessage = eventState.finalMessage;
    const resolvedStopReason = eventState.stopReason;
    const responseText = toText(resolvedFinalMessage);
    const responsePrefix = shouldPrefixResponse(profile.id, provider);
    const resolvedToolCalls = eventState.toolCalls;
    const resolvedToolResults = eventState.toolResults;

    return {
      route: input.route,
      stage: getAdapterStage(input.route, profileId, failed),
      result: `${responsePrefix}${responseText || requestContext.input}`,
      runMode,
      ...(continueReason ? { continueReason } : {}),
      toolCalls: resolvedToolCalls.length > 0 ? resolvedToolCalls : undefined,
      toolResults: resolvedToolResults.length > 0 ? resolvedToolResults : undefined,
      assistantMessage: resolvedFinalMessage,
      stopReason: failed ? "tool_error_or_runtime_error" : resolvedStopReason,
      provider,
      profileId,
    };
  };
}

export const runCodexAdapter = createRunCodexAdapter();
