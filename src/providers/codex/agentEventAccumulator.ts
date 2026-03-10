import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { Message, ToolResultMessage } from "@mariozechner/pi-ai";
import { chooseFirstToolError } from "../../tools/runtimeTools.js";
import type { ToolCall, ToolError, ToolExecutionLog } from "../../tools/types.js";

interface CreateCodexAgentEventAccumulatorOptions {
  provider: string;
  canonicalByCodexName?: Map<string, string>;
}

export interface CodexAgentEventAccumulator {
  readonly toolCalls: ToolCall[];
  readonly toolResults: ToolExecutionLog[];
  readonly toolError: ToolError | undefined;
  readonly finalMessage: Message | undefined;
  readonly stopReason: string | undefined;
  readonly hasToolCallEvents: boolean;
  readonly hasToolResultEvents: boolean;
  consume(event: AgentEvent): void;
}

function isMessage(value: AgentMessage | undefined): value is Message {
  return Boolean(value && typeof value === "object" && "role" in value);
}

function isAssistantMessage(
  value: AgentMessage | undefined,
): value is Extract<Message, { role: "assistant" }> {
  return isMessage(value) && value.role === "assistant";
}

function isToolResultMessage(value: AgentMessage | undefined): value is ToolResultMessage {
  return isMessage(value) && value.role === "toolResult";
}

function normalizeToolName(rawName: string, canonicalByCodexName: Map<string, string>): string {
  const normalized = rawName.trim();
  if (!normalized) {
    return normalized;
  }
  return canonicalByCodexName.get(normalized) ?? normalized;
}

function normalizeTextContent(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    return raw;
  }

  if (!Array.isArray(raw)) {
    return undefined;
  }

  const parts = raw
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }

      if (block.type === "text" && typeof (block as { text?: unknown }).text === "string") {
        return (block as { text: string }).text;
      }

      return "";
    })
    .filter((entry) => entry.length > 0);

  if (parts.length > 0) {
    return parts.join("\n");
  }

  if (raw.length === 0) {
    return "";
  }

  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

function resolveToolMeta(details: unknown, toolName: string): { tool: string; durationMs: number } {
  if (typeof details === "object" && details !== null) {
    const rawMeta = (details as { meta?: unknown }).meta;
    if (typeof rawMeta === "object" && rawMeta !== null) {
      const metaTool =
        typeof (rawMeta as { tool?: unknown }).tool === "string"
          ? ((rawMeta as { tool: string }).tool.trim() || toolName)
          : toolName;
      const durationMs =
        typeof (rawMeta as { durationMs?: unknown }).durationMs === "number" &&
        Number.isFinite((rawMeta as { durationMs: number }).durationMs)
          ? Math.max(0, (rawMeta as { durationMs: number }).durationMs)
          : 0;
      return {
        tool: metaTool,
        durationMs,
      };
    }
  }

  return {
    tool: toolName,
    durationMs: 0,
  };
}

function buildToolError(toolName: string, message: string | undefined): ToolError {
  return {
    code: "execution_error",
    tool: toolName,
    message: message && message.length > 0 ? message : `tool ${toolName} failed`,
  };
}

function buildToolExecutionLog(
  call: ToolCall,
  resultLike: { content?: unknown; details?: unknown },
  isError: boolean,
  partialResult?: unknown,
): ToolExecutionLog {
  const fallbackResultLike =
    typeof partialResult === "object" && partialResult !== null
      ? (partialResult as { content?: unknown; details?: unknown })
      : {};
  const content = normalizeTextContent(resultLike.content ?? fallbackResultLike.content);
  const meta = resolveToolMeta(resultLike.details ?? fallbackResultLike.details, call.name);

  if (isError) {
    return {
      call,
      result: {
        ok: false,
        ...(content !== undefined ? { content } : {}),
        error: buildToolError(call.name, content),
        meta,
      },
    };
  }

  return {
    call,
    result: {
      ok: true,
      ...(content !== undefined ? { content } : {}),
      meta,
    },
  };
}

function findLastAssistantMessage(messages: AgentMessage[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isAssistantMessage(message)) {
      return message;
    }
  }
  return undefined;
}

export function createCodexAgentEventAccumulator(
  options: CreateCodexAgentEventAccumulatorOptions,
): CodexAgentEventAccumulator {
  const provider = options.provider;
  const canonicalByCodexName = options.canonicalByCodexName ?? new Map<string, string>();
  const toolCalls: ToolCall[] = [];
  const toolResults: ToolExecutionLog[] = [];
  const toolCallIndexById = new Map<string, number>();
  const toolResultIndexById = new Map<string, number>();
  const partialToolResultById = new Map<string, unknown>();
  let toolError: ToolError | undefined;
  let finalMessage: Message | undefined;
  let stopReason: string | undefined;
  let hasToolCallEvents = false;
  let hasToolResultEvents = false;

  function upsertToolCall(call: ToolCall): ToolCall {
    const existingIndex = toolCallIndexById.get(call.id);
    if (existingIndex === undefined) {
      toolCallIndexById.set(call.id, toolCalls.length);
      toolCalls.push(call);
      return call;
    }

    const previous = toolCalls[existingIndex];
    const merged = {
      ...previous,
      ...call,
      name: call.name || previous.name,
      source: call.source ?? previous.source,
      ...(call.args !== undefined ? { args: call.args } : previous.args !== undefined ? { args: previous.args } : {}),
    };
    toolCalls[existingIndex] = merged;
    return merged;
  }

  function upsertToolResult(log: ToolExecutionLog): void {
    const existingIndex = toolResultIndexById.get(log.call.id);
    if (existingIndex === undefined) {
      toolResultIndexById.set(log.call.id, toolResults.length);
      toolResults.push(log);
    } else {
      toolResults[existingIndex] = {
        ...toolResults[existingIndex],
        ...log,
        call: log.call,
        result: {
          ...toolResults[existingIndex].result,
          ...log.result,
        },
      };
    }

    if (log.result.error) {
      toolError = chooseFirstToolError(toolError, log.result.error);
    }
    hasToolResultEvents = true;
  }

  function updateAssistantMessage(message: AgentMessage | undefined): void {
    if (!isAssistantMessage(message)) {
      return;
    }
    finalMessage = message;
    stopReason = message.stopReason;
  }

  function toToolCall(toolCallId: string, toolName: string, args: unknown): ToolCall {
    return {
      id: toolCallId,
      name: normalizeToolName(toolName, canonicalByCodexName),
      args,
      source: provider,
    };
  }

  function backfillToolResult(message: ToolResultMessage): void {
    const call = upsertToolCall(toToolCall(message.toolCallId, message.toolName, undefined));
    upsertToolResult(
      buildToolExecutionLog(
        call,
        {
          content: message.content,
          details: message.details,
        },
        message.isError,
      ),
    );
  }

  return {
    toolCalls,
    toolResults,
    get toolError() {
      return toolError;
    },
    get finalMessage() {
      return finalMessage;
    },
    get stopReason() {
      return stopReason;
    },
    get hasToolCallEvents() {
      return hasToolCallEvents;
    },
    get hasToolResultEvents() {
      return hasToolResultEvents;
    },
    consume(event: AgentEvent): void {
      switch (event.type) {
        case "message_start":
        case "message_update":
        case "message_end":
          updateAssistantMessage(event.message);
          if (isToolResultMessage(event.message)) {
            backfillToolResult(event.message);
          }
          break;
        case "tool_execution_start":
          hasToolCallEvents = true;
          upsertToolCall(toToolCall(event.toolCallId, event.toolName, event.args));
          break;
        case "tool_execution_update":
          hasToolCallEvents = true;
          upsertToolCall(toToolCall(event.toolCallId, event.toolName, event.args));
          partialToolResultById.set(event.toolCallId, event.partialResult);
          break;
        case "tool_execution_end": {
          hasToolCallEvents = true;
          const call = upsertToolCall(toToolCall(event.toolCallId, event.toolName, undefined));
          const resultLike =
            typeof event.result === "object" && event.result !== null
              ? (event.result as { content?: unknown; details?: unknown })
              : {};
          upsertToolResult(
            buildToolExecutionLog(
              call,
              resultLike,
              event.isError,
              partialToolResultById.get(event.toolCallId),
            ),
          );
          partialToolResultById.delete(event.toolCallId);
          break;
        }
        case "turn_end":
          updateAssistantMessage(event.message);
          for (const toolResult of event.toolResults) {
            backfillToolResult(toolResult);
          }
          break;
        case "agent_end": {
          const lastAssistantMessage = findLastAssistantMessage(event.messages);
          if (lastAssistantMessage) {
            updateAssistantMessage(lastAssistantMessage);
          }
          break;
        }
        default:
          break;
      }
    },
  };
}
