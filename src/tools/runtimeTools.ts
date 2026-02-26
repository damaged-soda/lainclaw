import { AgentTool } from "@mariozechner/pi-agent-core";
import { ContextToolSpec } from "../shared/types.js";
import type { ToolCall, ToolExecutionLog, ToolError } from "./types.js";

const RUNTIME_NAME_NORMALIZER = /[^a-zA-Z0-9_-]+/g;
const TOOL_NAME_FALLBACK_PREFIX = "tool_";

export interface RuntimeToolNameMap {
  codexByCanonical: Map<string, string>;
  canonicalByCodex: Map<string, string>;
}

export function createToolAdapter(
  tools: ContextToolSpec[],
  runTool: (call: ToolCall, signal?: AbortSignal) => Promise<ToolExecutionLog>,
  toolNameMap: RuntimeToolNameMap,
): AgentTool[] {
  const normalizedTools = Array.isArray(tools) ? tools.filter(isNamedToolSpec) : [];

  return normalizedTools.map((spec) => {
    const codexToolName = resolveRuntimeToolName(spec.name, toolNameMap);
    const canonicalToolName = toolNameMap.canonicalByCodex.get(codexToolName) ?? spec.name;

    return {
      name: codexToolName,
      label: spec.name,
      description: spec.description,
      parameters: spec.inputSchema as unknown as AgentTool["parameters"],
      execute: async (toolCallId, params, signal) => {
        const log = await runTool(
          {
            id: toolCallId,
            name: canonicalToolName,
            args: params,
            source: "agent-runtime",
          },
          signal,
        );

        if (!log.result.ok) {
          throw new Error(log.result.error?.message ?? `tool ${spec.name} failed`);
        }

        const contentText = normalizeToolContent(log.result.content);
        return {
          content: contentText ? [{ type: "text", text: contentText }] : [],
          details: {
            tool: canonicalToolName,
            toolCallId: log.call.id,
            meta: log.result.meta,
          },
        };
      },
    };
  });
}

export function resolveTools(input: ContextToolSpec[] | undefined, withTools: boolean): ContextToolSpec[] {
  if (!withTools || !Array.isArray(input)) {
    return [];
  }

  return input.filter(isNamedToolSpec);
}

function resolveRuntimeToolName(rawName: string, map: RuntimeToolNameMap): string {
  const normalized = toRuntimeToolName(rawName);
  return map.codexByCanonical.get(rawName) ?? normalized;
}

export function buildRuntimeToolNameMap(toolSpecs: ContextToolSpec[]): RuntimeToolNameMap {
  const usedNames = new Set<string>();
  const codexByCanonical = new Map<string, string>();
  const canonicalByCodex = new Map<string, string>();

  for (const spec of toolSpecs) {
    if (!isNamedToolSpec(spec)) {
      continue;
    }

    const canonical = spec.name;
    const preferred = toRuntimeToolName(canonical);
    let candidate = preferred;
    let suffix = 1;
    while (usedNames.has(candidate)) {
      suffix += 1;
      candidate = `${preferred}_${suffix}`;
    }

    usedNames.add(candidate);
    codexByCanonical.set(canonical, candidate);
    canonicalByCodex.set(candidate, canonical);
  }

  return { codexByCanonical, canonicalByCodex };
}

export function chooseFirstToolError(first: ToolError | undefined, next: ToolError | undefined): ToolError | undefined {
  return first ?? next;
}

export function firstToolErrorFromLogs(logs: ToolExecutionLog[] | undefined): ToolError | undefined {
  if (!Array.isArray(logs)) {
    return undefined;
  }

  for (const entry of logs) {
    if (entry?.result?.error) {
      return entry.result.error;
    }
  }

  return undefined;
}

export function buildToolMessages(calls: ToolCall[], results: ToolExecutionLog[]): string {
  const resultById = new Map<string, ToolExecutionLog>();
  const resultByName = new Map<string, ToolExecutionLog>();

  for (const result of results) {
    resultById.set(result.call.id, result);
    if (!resultByName.has(result.call.name)) {
      resultByName.set(result.call.name, result);
    }
  }

  const normalized = calls.map((call) => {
    const matched = resultById.get(call.id) || resultByName.get(call.name);
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

export function isNamedToolSpec(tool: ContextToolSpec | undefined): tool is ContextToolSpec {
  return Boolean(tool && typeof tool.name === "string" && tool.name.trim().length > 0);
}

function randomSuffix(): string {
  return Math.floor(Math.random() * 10000).toString(16).padStart(4, "0");
}

function toRuntimeToolName(rawName: string): string {
  const normalized = rawName.trim().replace(RUNTIME_NAME_NORMALIZER, "_");
  return normalized.length > 0 ? normalized : `${TOOL_NAME_FALLBACK_PREFIX}${randomSuffix()}`;
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
