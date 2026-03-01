import path from "node:path";
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel, type Message, type StopReason as PiStopReason } from "@mariozechner/pi-ai";
import { getOpenAICodexApiContext, OPENAI_CODEX_MODEL } from "../auth/authManager.js";
import { RequestContext } from "../shared/types.js";
import type { AdapterRunInput } from "./registry.js";
import type { AdapterResult } from "./stubAdapter.js";
import type { ToolCall, ToolExecutionLog, ToolError } from "../tools/types.js";
import { buildRuntimeToolNameMap, chooseFirstToolError, createToolAdapter, resolveTools } from "../tools/runtimeTools.js";
import { isToolAllowed } from "../tools/registry.js";
import { executeTool } from "../tools/executor.js";
import { parseToolCallsFromResponse } from "./codex/toolCallParser.js";
import { toText } from "./codex/messageText.js";

// 该系统提示词是 MVP 阶段的临时兜底：用于让 provider responses 在最小路径下可直接返回结果。
// 这是可替换配置，不是对外契约；后续接手时可按体验目标调整文案、样式或完全替换。
const OPENAI_CODEX_SYSTEM_PROMPT = "You are a concise and reliable coding assistant.";

const RANDOM_ID_BASE = 16;
const RANDOM_ID_PAD_LENGTH = 4;

function randomHexSegment(): string {
  return Math.floor(Math.random() * 10000).toString(RANDOM_ID_BASE).padStart(RANDOM_ID_PAD_LENGTH, "0");
}

function createToolCallId(rawToolName: string): string {
  return `lc-tool-${Date.now()}-${randomHexSegment()}-${randomHexSegment()}-${rawToolName}`;
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

function buildToolErrorLog(toolCall: ToolCall, message: string): ToolExecutionLog {
  return {
    call: { ...toolCall, source: "agent-runtime" },
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

function resolveBooleanFlag(raw: string | undefined): boolean {
  if (typeof raw !== "string") {
    return false;
  }
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
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

function normalizeMessages(context: RequestContext): Message[] {
  if (!Array.isArray(context.messages) || context.messages.length === 0) {
    return [
      {
        role: "user",
        content: context.input,
        timestamp: Date.now(),
      },
    ];
  }

  return context.messages;
}

interface ToolExecutionState {
  toolCalls: ToolCall[];
  toolResults: ToolExecutionLog[];
  readonly toolError: ToolError | undefined;
  record(log: ToolExecutionLog): void;
}

function createToolExecutionState(): ToolExecutionState {
  const toolCalls: ToolCall[] = [];
  const toolResults: ToolExecutionLog[] = [];
  const toolResultIndexById = new Map<string, number>();
  const toolLogById = new Map<string, ToolExecutionLog>();
  let toolError: ToolError | undefined;

  return {
    toolCalls,
    toolResults,
    get toolError() {
      return toolError;
    },
    record(log: ToolExecutionLog): void {
      const previousLog = toolLogById.get(log.call.id);
      const mergedLog = previousLog ? { ...previousLog, ...log, call: log.call } : log;
      const existingIndex = toolResultIndexById.get(log.call.id);

      if (existingIndex === undefined) {
        toolResultIndexById.set(log.call.id, toolResults.length);
        toolCalls.push(mergedLog.call);
        toolResults.push(mergedLog);
      } else {
        toolResults[existingIndex] = mergedLog;
      }

      toolLogById.set(log.call.id, mergedLog);

      if (log.result.error) {
        toolError = chooseFirstToolError(toolError, log.result.error);
      }
    },
  };
}

export async function runCodexAdapter(input: AdapterRunInput): Promise<AdapterResult> {
  const provider = normalizeProvider(input.requestContext.provider);
  if (provider !== "openai-codex") {
    throw new Error(`Unsupported provider for openai runtime: ${provider}`);
  }
  const requestContext = input.requestContext;
  const requestId = requestContext.requestId;
  const toolSpecs = resolveTools(input.toolSpecs, input.withTools);
  const cwd = path.resolve(input.cwd || process.cwd());
  const toolAllow = Array.isArray(input.toolAllow) ? input.toolAllow : [];
  const toolNameMap = buildRuntimeToolNameMap(toolSpecs);
  const toolState = createToolExecutionState();
  const canonicalByCodexName = toolNameMap.canonicalByCodex;

  const runTool = async (toolCall: ToolCall, signal?: AbortSignal): Promise<ToolExecutionLog> => {
    const resolvedCall: ToolCall = {
      ...toolCall,
      id: toolCall.id || createToolCallId(toolCall.name || "unknown"),
      source: "agent-runtime",
    };

    if (!isToolAllowed(resolvedCall.name, toolAllow)) {
      const blocked = buildToolErrorLog(resolvedCall, `tool not allowed: ${resolvedCall.name}`);
      toolState.record(blocked);
      return blocked;
    }

    const startedAt = Date.now();
    try {
      const execution = await executeTool(resolvedCall, {
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
  const { apiKey, profile } = await getOpenAICodexApiContext(requestContext.profileId);
  const model = getModel(provider, OPENAI_CODEX_MODEL);
  if (!model) {
    throw new Error(`No model found: ${provider}/${OPENAI_CODEX_MODEL}`);
  }
  const profileId = profile.id;

  const agent = new Agent({
    initialState: {
      systemPrompt: requestContext.systemPrompt ?? OPENAI_CODEX_SYSTEM_PROMPT,
      model,
      messages: normalizeMessages(requestContext),
      tools: agentTools,
    },
    convertToLlm: (messages) =>
      messages.filter((message) =>
        message.role === "user" || message.role === "assistant" || message.role === "toolResult",
      ) as Message[],
    getApiKey: async () => apiKey,
  });
  agent.setTools(agentTools);

  let finalMessage: Message | undefined;
  let finalStopReason: PiStopReason | undefined;
  let runErr: Error | undefined;

  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    if (event.type === "message_end" && event.message.role === "assistant") {
      finalMessage = event.message;
      finalStopReason = event.message.stopReason;
    }
  });

  try {
    await agent.prompt({
      role: "user",
      content: requestContext.input,
      timestamp: Date.now(),
    });
  } catch (error) {
    runErr = error instanceof Error ? error : new Error(String(error));
  } finally {
    unsubscribe();
  }

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
}
