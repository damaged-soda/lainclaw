import { complete, getModel } from "@mariozechner/pi-ai";
import type { Message, Tool as PiTool } from "@mariozechner/pi-ai";
import { getOpenAICodexApiContext, OPENAI_CODEX_MODEL } from "../auth/authManager.js";
import { ContextToolSpec, RequestContext } from "../shared/types.js";
import type { ToolCall } from "../tools/types.js";
import type { AdapterResult } from "./stubAdapter.js";

// 该系统提示词是 MVP 阶段的临时兜底：用于让 openai-codex responses 在最小路径下可直接返回结果。
// 这是可替换配置，不是对外契约；后续接手时可按体验目标调整文案、样式或完全替换。
const OPENAI_CODEX_SYSTEM_PROMPT = "You are a concise and reliable coding assistant.";

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

function extractTextFromResponse(response: { content?: unknown[] }): string {
  const content = response.content;
  if (!Array.isArray(content)) {
    return JSON.stringify(response);
  }

  const textBlocks = content
    .filter((block) => {
      if (!block || typeof block !== "object") {
        return false;
      }
      const candidate = block as { type?: unknown; text?: unknown };
      return candidate.type === "text" && typeof candidate.text === "string";
    })
    .map((block) => (block as { text?: string }).text)
    .filter((text) => typeof text === "string" && text.trim().length > 0);

  if (textBlocks.length > 0) {
    return textBlocks.join("\n");
  }

  return JSON.stringify(response);
}

function resolveBooleanFlag(raw: string | undefined): boolean {
  if (typeof raw !== "string") {
    return false;
  }
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function shouldPrefixResponse(profileId: string): string {
  if (!resolveBooleanFlag(process.env.LAINCLAW_CODEX_PREFIX_RESPONSE)) {
    return "";
  }
  return `[openai-codex:${profileId}] `;
}

function parseToolArguments(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function toCodexToolName(raw: string): string {
  const normalized = raw.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  if (normalized.length === 0) {
    return `tool-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
  }
  return normalized;
}

function createToolNameMap(contextTools: ContextToolSpec[]): {
  codexNameByCanonical: Map<string, string>;
  canonicalByCodexName: Map<string, string>;
} {
  const used = new Set<string>();
  const codexNameByCanonical = new Map<string, string>();
  const canonicalByCodexName = new Map<string, string>();

  for (const tool of contextTools) {
    let preferred = toCodexToolName(tool.name);
    if (preferred.length === 0) {
      preferred = `tool-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
    }
    let candidate = preferred;
    let suffix = 1;
    while (used.has(candidate)) {
      suffix += 1;
      candidate = `${preferred}_${suffix}`;
    }
    used.add(candidate);
    codexNameByCanonical.set(tool.name, candidate);
    canonicalByCodexName.set(candidate, tool.name);
  }

  return { codexNameByCanonical, canonicalByCodexName };
}

function parseToolCallsFromResponse(
  response: { content?: unknown[] },
  toolNameMap: Map<string, string> = new Map(),
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
        source: "codex",
      } as ToolCall;
    })
    .filter((entry): entry is ToolCall => Boolean(entry));
}

function mapToolSpecs(contextTools: ContextToolSpec[]): PiTool[] {
  const { codexNameByCanonical } = createToolNameMap(contextTools);
  return contextTools.map((tool) => ({
    name: codexNameByCanonical.get(tool.name) ?? toCodexToolName(tool.name),
    description: tool.description,
    parameters: tool.inputSchema,
  })) as unknown as PiTool[];
}

export async function runCodexAdapter(
  context: RequestContext,
  _route: string,
): Promise<AdapterResult> {
  const { apiKey, profile } = await getOpenAICodexApiContext(context.profileId);
  const model = getModel("openai-codex", OPENAI_CODEX_MODEL);
  if (!model) {
    throw new Error(`No model found: openai-codex/${OPENAI_CODEX_MODEL}`);
  }

  const response = await complete(
    model,
    {
      systemPrompt: context.systemPrompt ?? OPENAI_CODEX_SYSTEM_PROMPT,
      messages: normalizeMessages(context),
      ...(Array.isArray(context.tools) && context.tools.length > 0
        ? { tools: mapToolSpecs(context.tools) }
        : {}),
    },
    { apiKey },
  );
  const { canonicalByCodexName } = createToolNameMap(context.tools ?? []);
  const responseText = extractTextFromResponse(response);
  const responsePrefix = shouldPrefixResponse(profile.id);

  return {
    route: "codex",
    stage: `adapter.codex.${profile.id}`,
    result: `${responsePrefix}${responseText}`,
    provider: profile.provider,
    profileId: profile.id,
    toolCalls: parseToolCallsFromResponse(response, canonicalByCodexName),
    assistantMessage: response,
    stopReason: response.stopReason,
  };
}
