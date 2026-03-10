import path from "node:path";
import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
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
const OPENAI_CODEX_SYSTEM_PROMPT = "You are a concise and reliable coding assistant.";

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
        return log;
      } catch (error) {
        return buildToolErrorLog(
          resolvedCall,
          error instanceof Error ? error.message : "tool execution failed",
        );
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
            messages: convertAgentMessagesToLlm(transformedMessages),
            tools: toolSpecs,
            ...(promptMessage ? { prompt: promptMessage } : {}),
          }),
        });

        const unsubscribe = agent.subscribe((event: AgentEvent) => {
          eventState.consume(event);

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
          if (context.runMode === "continue") {
            await agent.continue();
          } else if (promptMessage) {
            await agent.prompt(promptMessage);
          } else {
            throw new Error("Prompt mode requires a user message.");
          }
        } catch (error) {
          runErr = error instanceof Error ? error : new Error(String(error));
        } finally {
          unsubscribe();
          await agentEventDispatch;
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
