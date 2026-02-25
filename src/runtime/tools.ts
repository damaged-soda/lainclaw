import type { Message } from "@mariozechner/pi-ai";
import { AgentTool } from "@mariozechner/pi-agent-core";
import { OPENAI_CODEX_MODEL } from "../auth/authManager.js";
import { ContextToolSpec } from "../shared/types.js";
import type { ToolCall, ToolExecutionLog, ToolError } from "../tools/types.js";
import { getToolInfo, listToolsCatalog } from "../tools/gateway.js";
import { isToolAllowed } from "../tools/registry.js";
import type { RuntimeExecutionState } from "./schema.js";

const TOOL_PARSE_PREFIX = "tool:";

export interface RuntimeToolNameMap {
  codexByCanonical: Map<string, string>;
  canonicalByCodex: Map<string, string>;
}

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

function randomSuffix(): string {
  return Math.floor(Math.random() * 10000).toString(16).padStart(4, "0");
}

function toRuntimeToolName(raw: string): string {
  const normalized = raw.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return normalized.length > 0 ? normalized : `tool_${randomSuffix()}`;
}

function isRuntimeToolValid(call: ToolCall): call is ToolCall {
  return !!call && typeof call === "object" && typeof call.name === "string" && call.name.trim().length > 0;
}

export function buildRuntimeToolNameMap(toolSpecs: ContextToolSpec[]): RuntimeToolNameMap {
  const used = new Set<string>();
  const codexByCanonical = new Map<string, string>();
  const canonicalByCodex = new Map<string, string>();

  for (const spec of toolSpecs) {
    if (!spec || typeof spec.name !== "string" || !spec.name.trim()) {
      continue;
    }

    const canonical = spec.name;
    let preferred = toRuntimeToolName(canonical);
    let candidate = preferred;
    let suffix = 1;
    while (used.has(candidate)) {
      suffix += 1;
      candidate = `${preferred}_${suffix}`;
    }
    used.add(candidate);
    codexByCanonical.set(canonical, candidate);
    canonicalByCodex.set(candidate, canonical);
  }

  return { codexByCanonical, canonicalByCodex };
}

function sanitizeRuntimeToolName(raw: string, codexByCanonical: Map<string, string>): string {
  return codexByCanonical.get(raw) ?? raw;
}

function remapToolNameInContent(content: unknown, codexByCanonical: Map<string, string>): unknown {
  if (!content || typeof content !== "object") {
    return content;
  }

  const candidate = content as Record<string, unknown>;
  const type = typeof candidate.type === "string" ? candidate.type : "";
  if (type !== "toolCall" && type !== "tool_call" && type !== "toolResult") {
    return content;
  }

  const toolName =
    typeof candidate.name === "string"
      ? candidate.name
      : typeof candidate.toolName === "string"
        ? candidate.toolName
        : "";
  if (!toolName) {
    return content;
  }

  const mapped = sanitizeRuntimeToolName(toolName, codexByCanonical);
  if (type === "toolResult") {
    return { ...candidate, toolName: mapped };
  }
  return { ...candidate, name: mapped };
}

export function remapRuntimeMessages(rawMessages: unknown, codexByCanonical: Map<string, string>): Message[] {
  if (!Array.isArray(rawMessages)) {
    return [];
  }

  return rawMessages
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }

      const message = item as Record<string, unknown>;
      const normalized: Record<string, unknown> = { ...message };

      if (Array.isArray(message.content)) {
        normalized.content = message.content.map((block) => remapToolNameInContent(block, codexByCanonical));
      }

      if (typeof message.toolName === "string") {
        normalized.toolName = sanitizeRuntimeToolName(message.toolName, codexByCanonical);
      }

      return normalized as unknown as Message;
    })
    .filter((item): item is Message => item !== undefined);
}

export function shouldFollowUpBeforeContinue(previous: RuntimeExecutionState): boolean {
  if (!previous) {
    return false;
  }

  if (previous.phase !== "running" && previous.phase !== "failed") {
    return false;
  }

  const hasPendingToolCalls =
    Array.isArray(previous.agentState?.pendingToolCalls) && previous.agentState.pendingToolCalls.length > 0;
  const hasInProgressTool = typeof previous.toolRunId === "string" && previous.toolRunId.length > 0;
  const lastMessage = (Array.isArray(previous.agentState?.messages) ? previous.agentState.messages : [])
    .at(-1);

  if (hasInProgressTool || hasPendingToolCalls) {
    return false;
  }

  return !!lastMessage && lastMessage.role !== "user";
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
            : `tool-${Date.now()}-${index + 1}-${randomSuffix()}`,
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

export function resolveTools(input: ContextToolSpec[] | undefined, withTools: boolean): ContextToolSpec[] {
  if (!withTools || !Array.isArray(input)) {
    return [];
  }
  return input.filter((item) => item && typeof item.name === "string" && item.name.trim().length > 0);
}

export function normalizeToolCall(call: ToolCall): ToolCall {
  return {
    ...call,
    id:
      isRuntimeToolValid(call) && typeof call.id === "string" && call.id.trim().length > 0
        ? call.id.trim()
        : `tool-${Date.now()}-${randomSuffix()}`,
    name: isRuntimeToolValid(call) ? call.name.trim() : "tool",
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

export function firstToolErrorFromLogs(logs: ToolExecutionLog[] | undefined): ToolError | undefined {
  if (!Array.isArray(logs)) {
    return undefined;
  }

  let found: ToolError | undefined;
  for (const entry of logs) {
    if (entry?.result?.error) {
      found = chooseFirstToolError(found, entry.result.error);
      if (found) {
        return found;
      }
    }
  }

  return found;
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

function normalizeToolContent(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw == null) {
    return "";
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

export function createToolAdapter(
  tools: ContextToolSpec[],
  runTool: (call: ToolCall, signal?: AbortSignal) => Promise<ToolExecutionLog>,
  toolNameMap: RuntimeToolNameMap,
  onToolRun?: () => void,
): AgentTool[] {
  const normalizedTools = Array.isArray(tools)
    ? tools.filter((tool): tool is ContextToolSpec => !!tool && typeof tool.name === "string")
    : [];

  return normalizedTools.map((spec) => ({
    name: toolNameMap.codexByCanonical.get(spec.name) ?? toRuntimeToolName(spec.name),
    label: spec.name,
    description: spec.description,
    parameters: spec.inputSchema as unknown as AgentTool["parameters"],
    execute: async (toolCallId, params, signal) => {
      onToolRun?.();
      const codexName = toolNameMap.codexByCanonical.get(spec.name) ?? toRuntimeToolName(spec.name);
      const canonicalName = toolNameMap.canonicalByCodex.get(codexName) ?? spec.name;
      const log = await runTool(
        {
          id: toolCallId,
          name: canonicalName,
          args: params,
          source: "agent-runtime",
        },
        signal,
      );
      if (!log.result.ok) {
        throw new Error(log.result.error?.message ?? `tool ${spec.name} failed`);
      }

      return {
        content: normalizeToolContent(log.result.content)
          ? [{ type: "text", text: normalizeToolContent(log.result.content) }]
          : [],
        details: {
          tool: canonicalName,
          toolCallId: log.call.id,
          meta: log.result.meta,
        },
      };
    },
  }));
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
        name: shouldSanitize ? toRuntimeToolName(call.name) : call.name,
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
