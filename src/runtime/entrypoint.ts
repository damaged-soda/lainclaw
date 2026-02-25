import path from "node:path";
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel, type Message, type StopReason as PiStopReason } from "@mariozechner/pi-ai";
import { getOpenAICodexApiContext, OPENAI_CODEX_MODEL } from "../auth/authManager.js";
import { ContextToolSpec, RequestContext } from "../shared/types.js";
import type { AdapterResult } from "../adapters/stubAdapter.js";
import {
  buildRuntimeToolNameMap,
  chooseFirstToolError,
  createToolAdapter,
  resolveTools,
} from "./tools.js";
import { isToolAllowed } from "../tools/registry.js";
import type { ToolCall, ToolExecutionLog, ToolError } from "../tools/types.js";
import { executeTool } from "../tools/executor.js";

interface RuntimeOptions {
  requestContext: RequestContext;
  channel: string;
  withTools: boolean;
  toolAllow: string[];
  cwd?: string;
  toolSpecs?: ContextToolSpec[];
}

const RUNTIME_PROVIDER = "openai-codex";
const RUNTIME_ADAPTER_STAGE_PREFIX = "adapter.codex";
const RANDOM_ID_BASE = 16;
const RANDOM_ID_PAD_LENGTH = 4;

function toText(message: Message | undefined): string {
  if (!message) {
    return "";
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  if (!Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }

      if (block.type === "text" && typeof (block as { text?: unknown }).text === "string") {
        return (block as { text: string }).text;
      }

      return "";
    })
    .filter((entry) => entry.length > 0)
    .join("\n");
}

function randomHexSegment(): string {
  return Math.floor(Math.random() * 10000).toString(RANDOM_ID_BASE).padStart(RANDOM_ID_PAD_LENGTH, "0");
}

function createToolCallId(rawToolName: string): string {
  return `lc-tool-${Date.now()}-${randomHexSegment()}-${randomHexSegment()}-${rawToolName}`;
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

function isAbortError(error: unknown): error is Error {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
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

export interface RuntimeResult {
  adapter: AdapterResult;
}

function getAdapterStage(profileId: string, hasFailure: boolean): string {
  return `${RUNTIME_ADAPTER_STAGE_PREFIX}.${profileId}${hasFailure ? ".failed" : ""}`;
}

export async function runOpenAICodexRuntime(input: RuntimeOptions): Promise<RuntimeResult> {
  const requestContext = input.requestContext;
  const requestId = requestContext.requestId;
  const toolSpecs = resolveTools(input.toolSpecs, input.withTools);
  const cwd = path.resolve(input.cwd || process.cwd());
  const toolAllow = input.toolAllow || [];
  const toolNameMap = buildRuntimeToolNameMap(toolSpecs);
  const toolState = createToolExecutionState();

  const { apiKey, profile } = await getOpenAICodexApiContext(requestContext.profileId);
  const model = getModel("openai-codex", OPENAI_CODEX_MODEL);
  if (!model) {
    throw new Error(`No model found: openai-codex/${OPENAI_CODEX_MODEL}`);
  }
  const profileId = profile.id;

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
  const agent = new Agent({
    initialState: {
      systemPrompt: requestContext.systemPrompt ?? "",
      model,
      messages: requestContext.messages,
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
  const finalAdapter: AdapterResult = {
    route: "codex",
    stage: getAdapterStage(profileId, failed),
    result: toText(finalMessage) || requestContext.input,
    toolCalls: toolState.toolCalls,
    toolResults: toolState.toolResults.length > 0 ? toolState.toolResults : undefined,
    assistantMessage: finalMessage,
    stopReason: failed ? "tool_error_or_runtime_error" : finalStopReason,
    provider: RUNTIME_PROVIDER,
    profileId,
  };

  return {
    adapter: finalAdapter,
  };
}
