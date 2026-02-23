import { builtinTools } from "./builtin/index.js";
import type { ToolSpec } from "./types.js";

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeAllowList(allowList?: string[]): Set<string> {
  if (!Array.isArray(allowList)) {
    return new Set();
  }
  const normalized = new Set<string>();
  for (const raw of allowList) {
    if (typeof raw === "string") {
      const name = normalizeName(raw);
      if (name) {
        normalized.add(name);
      }
    }
  }
  return normalized;
}

const registry = new Map<string, ToolSpec>(
  builtinTools.map((tool) => [normalizeName(tool.name), tool]),
);

const BUILTIN_TOOL_NAMES = Array.from(registry.values())
  .map((tool) => tool.name)
  .sort((left, right) => left.localeCompare(right));

export interface ToolQueryOptions {
  allowList?: string[];
}

export function isToolAllowed(name: string, allowList?: string[]): boolean {
  const allowSet = normalizeAllowList(allowList);
  if (allowSet.size === 0) {
    return true;
  }
  return allowSet.has(normalizeName(name));
}

export function listTools(options: ToolQueryOptions = {}): ToolSpec[] {
  const allowSet = normalizeAllowList(options.allowList);
  const entries = Array.from(registry.values()).filter((tool) => {
    if (allowSet.size === 0) {
      return true;
    }
    return allowSet.has(normalizeName(tool.name));
  });

  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

export function getBuiltinToolNames(): string[] {
  return [...BUILTIN_TOOL_NAMES];
}

export function getTool(name: string, options: ToolQueryOptions = {}): ToolSpec | undefined {
  if (!name || typeof name !== "string") {
    return undefined;
  }

  const tool = registry.get(normalizeName(name));
  if (!tool) {
    return undefined;
  }
  if (!isToolAllowed(tool.name, options.allowList)) {
    return undefined;
  }
  return tool;
}
