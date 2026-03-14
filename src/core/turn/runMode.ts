import type { Message } from "@mariozechner/pi-ai";
import { ValidationError } from "../../shared/types.js";
import type { RuntimeContinueReason, RuntimeRunMode } from "../../shared/types.js";
import type { ProviderPreparedState } from "../../providers/registry.js";

export interface ResolvedTurnRunMode {
  runMode: RuntimeRunMode;
  continueReason?: RuntimeContinueReason;
  lastMessageRole?: Message["role"];
}

export function resolveLastMessageRole(messages: Message[]): Message["role"] | undefined {
  const lastMessage = messages[messages.length - 1];
  return lastMessage?.role;
}

function resolveContinueReason(
  requestedContinueReason: RuntimeContinueReason | undefined,
  source: ProviderPreparedState["source"],
  lastMessageRole: Message["role"] | undefined,
): RuntimeContinueReason {
  if (requestedContinueReason) {
    return requestedContinueReason;
  }
  if (lastMessageRole === "toolResult") {
    return "tool_result";
  }
  if (source === "snapshot") {
    return "restore_resume";
  }
  return "retry";
}

export function resolveCoreTurnRunMode(input: {
  rawInput: string;
  requestedRunMode?: RuntimeRunMode;
  requestedContinueReason?: RuntimeContinueReason;
  source: ProviderPreparedState["source"];
  initialMessages: Message[];
}): ResolvedTurnRunMode {
  const normalizedInput = input.rawInput.trim();
  const lastMessageRole = resolveLastMessageRole(input.initialMessages);

  if (normalizedInput.length > 0) {
    return {
      runMode: "prompt",
      lastMessageRole,
    };
  }

  if (input.requestedRunMode !== "continue") {
    throw new ValidationError(
      "Cannot run without user input. Use continue mode to resume the agent.",
      "VALIDATION_ERROR",
    );
  }

  if (!lastMessageRole) {
    throw new ValidationError("Cannot continue without existing agent state.", "VALIDATION_ERROR");
  }

  if (lastMessageRole === "assistant") {
    throw new ValidationError("Cannot continue from last message role: assistant", "VALIDATION_ERROR");
  }

  return {
    runMode: "continue",
    continueReason: resolveContinueReason(
      input.requestedContinueReason,
      input.source,
      lastMessageRole,
    ),
    lastMessageRole,
  };
}
