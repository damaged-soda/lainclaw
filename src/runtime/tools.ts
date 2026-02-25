import type { Message } from "@mariozechner/pi-ai";
import { AgentTool } from "@mariozechner/pi-agent-core";
import { ContextToolSpec } from "../shared/types.js";
import type { ToolCall, ToolExecutionLog, ToolError } from "../tools/types.js";
import { listToolsCatalog } from "../tools/gateway.js";
import type { RuntimeExecutionState } from "./schema.js";

export interface RuntimeToolNameMap {
  codexByCanonical: Map<string, string>;
  canonicalByCodex: Map<string, string>;
}

// Core flow: createToolAdapter 是 runtime 的工具闭环入口，外层只负责协作，细节在内部函数里分解。
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

function randomSuffix(): string {
  return Math.floor(Math.random() * 10000).toString(16).padStart(4, "0");
}

function toRuntimeToolName(raw: string): string {
  const normalized = raw.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return normalized.length > 0 ? normalized : `tool_${randomSuffix()}`;
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

export function resolveTools(input: ContextToolSpec[] | undefined, withTools: boolean): ContextToolSpec[] {
  if (!withTools || !Array.isArray(input)) {
    return [];
  }
  return input.filter((item) => item && typeof item.name === "string" && item.name.trim().length > 0);
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

export function listAutoTools(toolAllow: string[]) {
  return listToolsCatalog(toolAllow);
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
