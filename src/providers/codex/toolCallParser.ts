import type { ToolCall } from "../../tools/types.js";

export function parseToolArguments(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

type ParsedToolCallResponse = {
  content?: unknown[];
};

export function parseToolCallsFromResponse(
  response: ParsedToolCallResponse,
  toolNameMap: Map<string, string> = new Map(),
  sourceProvider: string,
): ToolCall[] {
  if (!Array.isArray(response.content)) {
    return [];
  }

  return response.content
    .map((block, index) => {
      if (!block || typeof block !== "object") {
        return undefined;
      }

      const candidate = block as {
        type?: unknown;
        id?: unknown;
        name?: unknown;
        arguments?: unknown;
      };

      if (candidate.type !== "toolCall" && candidate.type !== "tool_call") {
        return undefined;
      }

      const rawName = typeof candidate.name === "string" ? candidate.name.trim() : "";
      if (!rawName) {
        return undefined;
      }

      const canonicalName = toolNameMap.get(rawName) ?? rawName;

      const rawId =
        typeof candidate.id === "string" && candidate.id.trim().length > 0
          ? candidate.id.trim()
          : `tool-${Date.now()}-${index + 1}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;

      return {
        id: rawId,
        name: canonicalName,
        args: parseToolArguments(candidate.arguments),
        source: sourceProvider,
      } as ToolCall;
    })
    .filter((entry): entry is ToolCall => Boolean(entry));
}
