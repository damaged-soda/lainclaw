import { complete, getModel } from "@mariozechner/pi-ai";
import type { Message } from "@mariozechner/pi-ai";
import { getOpenAICodexApiContext, OPENAI_CODEX_MODEL } from "../auth/authManager.js";
import { RequestContext } from "../shared/types.js";
import type { AdapterResult } from "./stubAdapter.js";

// 该系统提示词是 MVP 阶段的临时兜底：用于让 openai-codex responses 在最小路径下可直接返回结果。
// 这是可替换配置，不是对外契约；后续接手时可按体验目标调整文案、风格或完全替换。
const OPENAI_CODEX_SYSTEM_PROMPT = "You are a concise and reliable coding assistant.";

function normalizeMessages(context: RequestContext): Message[] {
  if (!Array.isArray(context.messages) || context.messages.length === 0) {
    const fallback: Message = {
      role: "user",
      content: context.input,
      timestamp: Date.now(),
    };
    return [fallback];
  }

  const historyContext = context.messages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  const userPrompt: Message = {
    role: "user",
    content: `历史上下文：\n${historyContext}\n\n当前输入：${context.input}`,
    timestamp: Date.now(),
  };
  return [userPrompt];
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

export async function runCodexAdapter(
  context: RequestContext,
  _route: string,
): Promise<AdapterResult> {
  const { apiKey, profile } = await getOpenAICodexApiContext(context.profileId);
  const model = getModel("openai-codex", OPENAI_CODEX_MODEL);
  if (!model) {
    throw new Error(`No model found: openai-codex/${OPENAI_CODEX_MODEL}`);
  }

  const response = await complete(model, {
    systemPrompt: OPENAI_CODEX_SYSTEM_PROMPT,
    messages: normalizeMessages(context),
  }, { apiKey });
  const result = extractTextFromResponse(response);
  return {
    route: "codex",
    stage: `adapter.codex.${profile.id}`,
    result: `[openai-codex:${profile.id}] ${result}`,
    provider: profile.provider,
    profileId: profile.id,
  };
}
