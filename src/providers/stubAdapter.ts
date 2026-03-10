import type { Message } from "@mariozechner/pi-ai";
import type { ToolExecutionLog } from "../tools/types.js";
import type { ProviderRunInput } from "./registry.js";
import { ValidationError } from "../shared/types.js";
import type { RuntimeContinueReason, RuntimeRunMode } from "../shared/types.js";

export interface ProviderResult {
  route: string;
  stage: string;
  result: string;
  runMode: RuntimeRunMode;
  continueReason?: RuntimeContinueReason;
  toolCalls?: import("../tools/types.js").ToolCall[];
  toolResults?: ToolExecutionLog[];
  assistantMessage?: Message;
  stopReason?: string;
  provider: string;
  profileId: string;
}

export type AdapterResult = ProviderResult;

export async function runStubAdapter(input: ProviderRunInput): Promise<ProviderResult> {
  const context = input.requestContext;
  const route = input.route;
  const rawProvider = context.provider;
  const provider = rawProvider.trim();
  if (!provider) {
    throw new ValidationError("Missing provider. Set --provider in runtime input.", "MISSING_PROVIDER");
  }
  const normalizedInput = input.requestContext.input.trim();
  const modeLabel = context.runMode === "continue"
    ? `continue:${context.continueReason ?? "resume"}`
    : "prompt";
  const normalizedPayload = normalizedInput || "continue";
  const assistantMessage: Message = {
    role: "assistant",
    content: [
      {
        type: "text",
        text: context.input,
      },
    ],
    api: `${provider}-responses`,
    provider,
    model: `${provider}-stub`,
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

  if (route === "summary") {
    return {
      route,
      stage: "adapter.stub.summary",
      result: `[stub-summary][${modeLabel}] 我已接收到你的内容：${normalizedPayload}`,
      runMode: context.runMode,
      ...(context.continueReason ? { continueReason: context.continueReason } : {}),
      assistantMessage,
      stopReason: assistantMessage.stopReason,
      provider,
      profileId: context.profileId,
    };
  }

  return {
    route,
    stage: "adapter.stub.echo",
    result: `[stub-echo][${context.sessionId}][${modeLabel}] 已接收到输入：${normalizedPayload}`,
    runMode: context.runMode,
    ...(context.continueReason ? { continueReason: context.continueReason } : {}),
    assistantMessage,
    stopReason: assistantMessage.stopReason,
    provider,
    profileId: context.profileId,
  };
}
