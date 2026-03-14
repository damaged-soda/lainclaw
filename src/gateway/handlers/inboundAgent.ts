import type { MessageInboundMessage } from "../../channels/contracts.js";
import { runAgent } from "../index.js";
import type { RuntimeAgentEventSink } from "../../shared/types.js";
import type { GatewayAgentRuntimeContext } from "../runtimeConfig.js";

export interface InboundAgentTurnRequest {
  inbound: MessageInboundMessage;
  runtime: GatewayAgentRuntimeContext;
  onAgentEvent?: RuntimeAgentEventSink;
  runAgentFn?: typeof runAgent;
}

export interface InboundAgentTurnResult {
  requestId: string;
  replyTo: string;
  sessionKey: string;
  text: string;
  isNewSession?: boolean;
}

interface InboundBuiltinCommand {
  kind: "new-session";
  replyText: string;
}

export function resolveBuiltinInboundCommand(input: string): InboundBuiltinCommand | undefined {
  const normalized = input.trim();
  if (normalized === "/new") {
    return {
      kind: "new-session",
      replyText: "已为你开启新会话。接下来我会按新的上下文继续。",
    };
  }
  return undefined;
}

export function resolveSessionKey(message: MessageInboundMessage): string {
  const actorId = message.actorId.trim() || message.requestId;
  const conversationId = message.conversationId.trim() || message.requestId;
  return `${actorId}:${conversationId}`;
}

export function buildInboundFailureText(
  inbound: MessageInboundMessage,
  rawMessage: string,
  onFailureHint?: (rawMessage: string) => string,
): string {
  const hint = onFailureHint ? onFailureHint(rawMessage) : rawMessage;
  return `[Lainclaw] ${hint}（requestId: ${inbound.requestId}）`;
}

export async function runInboundAgentTurn(
  request: InboundAgentTurnRequest,
): Promise<InboundAgentTurnResult> {
  const input = request.inbound.text.trim();
  const sessionKey = resolveSessionKey(request.inbound);
  const runAgentFn = request.runAgentFn ?? runAgent;
  const actorId = request.inbound.actorId.trim();
  const runtime = actorId
    ? {
      ...request.runtime,
      userId: actorId,
    }
    : request.runtime;
  const builtinCommand = resolveBuiltinInboundCommand(input);

  if (builtinCommand?.kind === "new-session") {
    const result = await runAgentFn({
      input,
      channelId: request.inbound.channel,
      sessionKey,
      runtime: {
        ...runtime,
        newSession: true,
      },
      ...(request.onAgentEvent ? { onAgentEvent: request.onAgentEvent } : {}),
    });

    return {
      requestId: request.inbound.requestId,
      replyTo: request.inbound.replyTo,
      sessionKey: result.sessionKey,
      text: builtinCommand.replyText,
      isNewSession: result.isNewSession,
    };
  }

  const result = await runAgentFn({
    input,
    channelId: request.inbound.channel,
    sessionKey,
    runtime,
    ...(request.onAgentEvent ? { onAgentEvent: request.onAgentEvent } : {}),
  });

  return {
    requestId: request.inbound.requestId,
    replyTo: request.inbound.replyTo,
    sessionKey: result.sessionKey,
    text: result.text,
    isNewSession: result.isNewSession,
  };
}
