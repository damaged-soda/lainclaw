import { builtinTools } from "./builtin/index.js";
import type { ToolSpec } from "./types.js";

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

const registry = new Map<string, ToolSpec>(
  builtinTools.map((tool) => [normalizeName(tool.name), tool]),
);

export function listTools(): ToolSpec[] {
  return Array.from(registry.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export function getTool(name: string): ToolSpec | undefined {
  if (!name || typeof name !== "string") {
    return undefined;
  }

  const tool = registry.get(normalizeName(name));
  if (!tool) {
    return undefined;
  }
  return tool;
}
