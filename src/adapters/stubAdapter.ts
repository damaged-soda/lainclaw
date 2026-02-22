import type { Message } from "@mariozechner/pi-ai";
import { RequestContext } from "../shared/types.js";

export interface AdapterResult {
  route: string;
  stage: string;
  result: string;
  toolCalls?: import("../tools/types.js").ToolCall[];
  assistantMessage?: Message;
  stopReason?: string;
  provider?: string;
  profileId?: string;
}

export function runStubAdapter(context: RequestContext, route: string): AdapterResult {
  const normalizedInput = context.input.trim();
  const historyCount = Array.isArray(context.messages) ? context.messages.length : 0;
  const shortHistory = `context=${historyCount}条消息`;
  const assistantMessage: Message = {
    role: "assistant",
    content: [
      {
        type: "text",
        text: context.input,
      },
    ],
    api: "openai-codex-responses",
    provider: context.provider || "openai-codex",
    model: context.provider === "openai-codex" ? "codex-stub" : "stub",
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
    stopReason: "stop",
    timestamp: Date.now(),
  };

  if (route === 'summary') {
    return {
      route,
      stage: 'adapter.stub.summary',
      result: `[stub-summary] ${shortHistory}：我已接收到你的内容：${normalizedInput}`,
      assistantMessage,
      stopReason: assistantMessage.stopReason,
    };
  }

  return {
    route,
    stage: 'adapter.stub.echo',
    result: `[stub-echo][${context.sessionId}] ${shortHistory}，已接收到输入：${normalizedInput}`,
    assistantMessage,
    stopReason: assistantMessage.stopReason,
  };
}
