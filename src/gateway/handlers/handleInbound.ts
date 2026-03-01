import {
  type IgnoredInboundMessage,
  type InboundMessage,
  type MessageInboundMessage,
  type OutboundMessage,
} from '../../channels/contracts.js';
import { evaluateAccessPolicy } from './policy/accessPolicy.js';
import { runAgent } from '../index.js';

const DEFAULT_AGENT_TIMEOUT_MS = 10000;

type AgentMessage = MessageInboundMessage | IgnoredInboundMessage;

interface AgentRuntimeContext {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  toolAllow?: string[];
  memory?: boolean;
}

interface HandleInboundOptions {
  runtime: AgentRuntimeContext;
  policyConfig?: unknown;
  timeoutMs?: number;
  onFailureHint?: (rawMessage: string) => string;
}

export async function handleInbound(
  inbound: InboundMessage,
  options: HandleInboundOptions,
): Promise<OutboundMessage | void> {
  const message = inbound as AgentMessage;
  if (message.kind !== 'message') {
    return;
  }

  const input = message.text.trim();
  if (!input) {
    return;
  }

  const sessionKey = resolveSessionKey(message);
  const decision = await evaluateAccessPolicy({
    inbound: message,
    config: options.policyConfig,
  });

  if (!decision.allowed) {
    if (!decision.replyText) {
      return;
    }
    return {
      requestId: message.requestId,
      replyTo: message.replyTo,
      text: decision.replyText,
      meta: {
        ...(message.meta || {}),
        inboundChannel: inbound.channel,
      },
    };
  }

  try {
    const responseText = await runAgentWithTimeout({
      input,
      channelId: message.channel,
      sessionKey,
      runtime: options.runtime,
      timeoutMs: options.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS,
    });

    return {
      requestId: message.requestId,
      replyTo: message.replyTo,
      text: responseText,
    };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const hint = options.onFailureHint ? options.onFailureHint(rawMessage) : rawMessage;
    return {
      requestId: message.requestId,
      replyTo: message.replyTo,
      text: `[Lainclaw] ${hint}（requestId: ${message.requestId}）`,
    };
  }
}

interface AgentRequest {
  input: string;
  channelId: string;
  sessionKey: string;
  runtime: AgentRuntimeContext;
  timeoutMs: number;
}

async function runAgentWithTimeout(params: AgentRequest): Promise<string> {
  const timeoutMs = Number.isFinite(params.timeoutMs) && params.timeoutMs > 0
    ? params.timeoutMs
    : DEFAULT_AGENT_TIMEOUT_MS;

  const invoke = runAgent({
    input: params.input,
    channelId: params.channelId,
    sessionKey: params.sessionKey,
    runtime: {
      provider: params.runtime.provider,
      profileId: params.runtime.profileId,
      withTools: params.runtime.withTools,
      toolAllow: params.runtime.toolAllow,
      memory: params.runtime.memory,
    },
  });

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`agent timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const result = await Promise.race([invoke, timeout]);
  return (result as { text: string }).text;
}

function resolveSessionKey(message: MessageInboundMessage): string {
  const actorId = message.actorId.trim() || message.requestId;
  const conversationId = message.conversationId.trim() || message.requestId;
  return `${actorId}:${conversationId}`;
}
