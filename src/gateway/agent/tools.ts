import type { Message } from "@mariozechner/pi-ai";
import path from "node:path";
import { OPENAI_CODEX_MODEL } from "../../auth/authManager.js";
import type { ToolCall, ToolContext, ToolExecutionLog, ToolError } from "../../tools/types.js";
import { getToolInfo, invokeToolsForAgent, listToolsCatalog } from "../../tools/gateway.js";
import { isToolAllowed } from "../../tools/registry.js";

const TOOL_PARSE_PREFIX = "tool:";

export interface DeniedToolCall {
  call: ToolCall;
  code: ToolError["code"];
  message: string;
}

export interface ToolLoopState {
  roundCalls: ToolCall[];
  roundResults: ToolExecutionLog[];
}

export interface ParseToolInput {
  toolCalls: ToolCall[];
  residualInput: string;
  parseError?: string;
}

export function parseToolCallsFromPrompt(rawInput: string): ParseToolInput {
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith(TOOL_PARSE_PREFIX)) {
    return {
      toolCalls: [],
      residualInput: rawInput,
    };
  }

  const payload = trimmed.slice(TOOL_PARSE_PREFIX.length).trim();
  if (!payload) {
    return {
      toolCalls: [],
      residualInput: "",
      parseError: "tool invocation missing content",
    };
  }

  let command = payload;
  let residualInput = "";
  const separator = payload.indexOf("\n");
  if (separator >= 0) {
    command = payload.slice(0, separator).trim();
    residualInput = payload.slice(separator + 1).trim();
  }

  if (!command) {
    return {
      toolCalls: [],
      residualInput,
      parseError: "tool invocation missing call payload",
    };
  }

  try {
    let entries: unknown[] = [];
    if (command.startsWith("[") || command.startsWith("{")) {
      const parsed = JSON.parse(command);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      if (list.length === 0) {
        return {
          toolCalls: [],
          residualInput,
          parseError: "tool invocation array is empty",
        };
      }
      entries = list;
    } else {
      const firstSpace = command.search(/\s/);
      const name = firstSpace >= 0 ? command.slice(0, firstSpace).trim() : command;
      const argsText = firstSpace >= 0 ? command.slice(firstSpace + 1).trim() : "";
      const args = argsText ? JSON.parse(argsText) : {};
      entries = [{ name, args }];
    }

    const toolCalls = entries.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`tool invocation #${index + 1} is invalid`);
      }

      const normalized = entry as Partial<ToolCall>;
      const name = typeof normalized.name === "string" ? normalized.name.trim() : "";
      if (!name) {
        throw new Error(`tool invocation #${index + 1} missing name`);
      }

      return {
        id:
          typeof normalized.id === "string" && normalized.id.trim().length > 0
            ? normalized.id.trim()
            : `tool-${Date.now()}-${index + 1}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`,
        name,
        args: normalized.args,
        source: "agent",
      } as ToolCall;
    });

    return {
      toolCalls,
      residualInput,
    };
  } catch (error) {
    return {
      toolCalls: [],
      residualInput,
      parseError: error instanceof Error ? error.message : "invalid tool payload",
    };
  }
}

export function normalizeToolCall(call: ToolCall): ToolCall {
  return {
    ...call,
    id:
      typeof call.id === "string" && call.id.trim().length > 0
        ? call.id.trim()
        : `tool-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`,
    name: call.name.trim(),
  };
}

export function makeToolExecutionError(call: ToolCall, message: string, code: ToolError["code"]): ToolExecutionLog {
  const normalized = normalizeToolCall(call);
  return {
    call: normalized,
    result: {
      ok: false,
      content: undefined,
      error: {
        tool: normalized.name,
        code,
        message,
      },
      meta: {
        tool: normalized.name,
        durationMs: 0,
      },
    },
  };
}

export function chooseFirstToolError(first: ToolError | undefined, next: ToolError | undefined): ToolError | undefined {
  if (first) {
    return first;
  }
  return next;
}

export function classifyToolCalls(calls: ToolCall[], toolAllow: string[]): {
  allowed: ToolCall[];
  denied: DeniedToolCall[];
} {
  return calls.reduce(
    (acc, call) => {
      const normalized = normalizeToolCall(call);
      const name = normalized.name;
      if (!isToolAllowed(name, toolAllow)) {
        acc.denied.push({
          call: normalized,
          code: "tool_not_found",
          message: `tool not allowed: ${name}`,
        });
        return acc;
      }
      if (!getToolInfo(name, toolAllow)) {
        acc.denied.push({
          call: normalized,
          code: "tool_not_found",
          message: `tool not found: ${name}`,
        });
        return acc;
      }
      acc.allowed.push(normalized);
      return acc;
    },
    { allowed: [], denied: [] } as { allowed: ToolCall[]; denied: DeniedToolCall[] },
  );
}

export async function executeAllowedToolCalls(
  requestId: string,
  sessionId: string,
  sessionKey: string,
  calls: ToolCall[],
  cwd?: string,
): Promise<{ logs: ToolExecutionLog[]; toolError?: ToolError }> {
  if (calls.length === 0) {
    return { logs: [], toolError: undefined };
  }

  const resolvedCwd = typeof cwd === "string" && cwd.trim().length > 0 ? path.resolve(cwd) : process.cwd();
  const toolContext: ToolContext = {
    requestId,
    sessionId,
    sessionKey,
    cwd: resolvedCwd,
  };
  const logs = await invokeToolsForAgent(calls, toolContext);
  const firstError = logs.find((log) => log.result.error)?.result.error;
  return { logs, toolError: firstError };
}

function toCodexToolName(raw: string): string {
  const normalized = raw.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return normalized.length > 0 ? normalized : `tool-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
}

export function makeAssistantToolContextMessage(
  calls: ToolCall[],
  resultText: string,
  stopReason?: string,
  provider?: string,
): Message {
  const shouldSanitize = provider === "openai-codex";
  return {
    role: "assistant",
    content: [
      ...(resultText ? [{ type: "text", text: resultText }] : []),
      ...calls.map((call) => ({
        type: "toolCall",
        id: call.id,
        name: shouldSanitize ? toCodexToolName(call.name) : call.name,
        arguments: call.args,
      })),
    ],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: OPENAI_CODEX_MODEL,
    usage: {
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
    },
    stopReason: stopReason ?? "toolUse",
    timestamp: Date.now(),
  } as Message;
}

export function makeToolResultContextMessage(log: ToolExecutionLog): Message {
  const normalizedResult = log.result.ok
    ? log.result.content
    : log.result.error
      ? log.result.error.message
      : "tool execution failed";
  return {
    role: "toolResult" as const,
    toolCallId: log.call.id,
    toolName: log.call.name,
    content: [{ type: "text", text: `${normalizedResult ?? ""}` }],
    isError: !log.result.ok,
    timestamp: Date.now(),
  } as Message;
}

export function appendToolCallContextMessages(
  requestMessages: Message[],
  round: ToolLoopState,
  resultText: string,
  stopReason?: string,
  provider?: string,
): void {
  requestMessages.push(makeAssistantToolContextMessage(round.roundCalls, resultText, stopReason, provider));
  requestMessages.push(...round.roundResults.map(makeToolResultContextMessage));
}

export function buildToolMessages(calls: ToolCall[], results: ToolExecutionLog[]): string {
  const normalized = calls.map((call) => {
    const matched = results.find((result) => result.call.id === call.id || result.call.name === call.name);
    if (!matched) {
      return {
        call,
        result: {
          ok: false,
          error: {
            code: "execution_error",
            tool: call.name,
            message: "tool result missing",
          },
        },
      };
    }

    return {
      call: matched.call,
      result: matched.result,
    };
  });

  return JSON.stringify(normalized, null, 2);
}

export function resolveStepLimitError(toolCalls: ToolCall[], toolMaxSteps: number): ToolError {
  const tool = toolCalls[0]?.name ?? "unknown";
  return {
    tool,
    code: "execution_error",
    message: `tool call loop exceeded max steps (${toolMaxSteps})`,
  };
}

export function listAutoTools(toolAllow: string[]) {
  return listToolsCatalog(toolAllow);
}
