import type { Message } from "@mariozechner/pi-ai";
import type { ProviderResult, ProviderRunInput } from "./registry.js";
import { ValidationError } from "../shared/types.js";

export async function runStubAdapter(input: ProviderRunInput): Promise<ProviderResult> {
  const context = input.requestContext;
  const rawProvider = context.provider;
  const provider = rawProvider.trim();
  const route = `adapter.${provider}`;
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
