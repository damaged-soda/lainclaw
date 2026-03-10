import path from "node:path";
import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel, type Message, type StopReason as PiStopReason } from "@mariozechner/pi-ai";
import { getOpenAICodexApiContext, OPENAI_CODEX_MODEL } from "../auth/authManager.js";
import type { RequestContext } from "../shared/types.js";
import type { ProviderRunInput } from "./registry.js";
import type { ProviderResult } from "./stubAdapter.js";
import type { ToolCall, ToolExecutionLog } from "../tools/types.js";
import { buildRuntimeToolNameMap, createToolAdapter, resolveTools } from "../tools/runtimeTools.js";
import { executeTool } from "../tools/executor.js";
import { createToolCallId } from "../shared/ids.js";
import { resolveBooleanFlag } from "../shared/envFlags.js";
import { parseToolCallsFromResponse } from "../providers/codex/toolCallParser.js";
import { buildToolErrorLog, createToolExecutionState } from "../providers/codex/toolExecutionState.js";
import { toText } from "../providers/codex/messageText.js";
import { writeDebugLogIfEnabled } from "../shared/debug.js";
import { buildCodexDebugRequestSnapshot } from "./codexDebug.js";
import {
  sessionAgentManager as defaultSessionAgentManager,
  type SessionAgentManager,
} from "../runtime/sessionAgentManager.js";

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
    const toolState = createToolExecutionState();
    const canonicalByCodexName = toolNameMap.canonicalByCodex;

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
        toolState.record(log);
        return log;
      } catch (error) {
        const failed = buildToolErrorLog(
          resolvedCall,
          error instanceof Error ? error.message : "tool execution failed",
        );
        toolState.record(failed);
        return failed;
      }
    };

    const agentTools = createToolAdapter(toolSpecs, runTool, toolNameMap);
    const { apiKey, profile } = await getApiContextFn(requestContext.profileId);
    const model = getModelFn(provider, OPENAI_CODEX_MODEL);
    if (!model) {
      throw new Error(`No model found: ${provider}/${OPENAI_CODEX_MODEL}`);
    }

    const profileId = profile.id;
    const initialMessages = requestContext.initialMessages;
    const systemPrompt = requestContext.systemPrompt ?? OPENAI_CODEX_SYSTEM_PROMPT;
    const promptMessage: Message = {
      role: "user",
      content: requestContext.input,
      timestamp: Date.now(),
    };

    writeDebugLogIfEnabled(requestContext.debug, "provider.codex.system_prompt_attached", {
      requestId,
      sessionKey: requestContext.sessionKey,
      provider,
      profileId,
      source: requestContext.systemPrompt ? "request_context" : "default",
      systemPrompt,
    });

    writeDebugLogIfEnabled(requestContext.debug, "provider.codex.pi_agent_core_request", {
      requestId,
      sessionKey: requestContext.sessionKey,
      provider,
      profileId,
      route: input.route,
      withTools: input.withTools,
      request: buildCodexDebugRequestSnapshot({
        systemPrompt,
        modelName: OPENAI_CODEX_MODEL,
        messages: initialMessages,
        tools: toolSpecs,
        prompt: promptMessage,
      }),
    });

    let finalMessage: Message | undefined;
    let finalStopReason: PiStopReason | undefined;
    let runErr: Error | undefined;
    let agentSource: "memory" | "snapshot" | "new" = "new";

    await sessionAgentManager.runWithSessionAgent(
      {
        sessionKey: requestContext.sessionKey,
        sessionId: requestContext.sessionId,
        provider,
        profileId,
        systemPrompt,
        model,
        tools: agentTools,
        initialMessages,
        convertToLlm: (messages: AgentMessage[]) =>
          messages.filter((message) =>
            message.role === "user" || message.role === "assistant" || message.role === "toolResult",
          ) as Message[],
        getApiKey: async () => apiKey,
        debug: requestContext.debug === true,
      },
      async (agent, context) => {
        agentSource = context.source;
        const unsubscribe = agent.subscribe((event: AgentEvent) => {
          if (event.type === "message_end" && event.message.role === "assistant") {
            finalMessage = event.message;
            finalStopReason = event.message.stopReason;
          }
        });

        try {
          await agent.prompt(promptMessage);
        } catch (error) {
          runErr = error instanceof Error ? error : new Error(String(error));
        } finally {
          unsubscribe();
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

    if (runErr && !toolState.toolError && !isAbortError(runErr)) {
      throw runErr;
    }

    const failed = Boolean(runErr);
    const responseText = toText(finalMessage);
    const responsePrefix = shouldPrefixResponse(profile.id, provider);
    const toolBlockContent = finalMessage && Array.isArray(finalMessage.content) ? finalMessage.content : [];
    const toolCalls = parseToolCallsFromResponse(
      { content: toolBlockContent },
      canonicalByCodexName,
      provider,
    );

    return {
      route: input.route,
      stage: getAdapterStage(input.route, profileId, failed),
      result: `${responsePrefix}${responseText || requestContext.input}`,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      toolResults: toolState.toolResults.length > 0 ? toolState.toolResults : undefined,
      assistantMessage: finalMessage,
      stopReason: failed ? "tool_error_or_runtime_error" : finalStopReason,
      provider,
      profileId,
    };
  };
}

export const runCodexAdapter = createRunCodexAdapter();
