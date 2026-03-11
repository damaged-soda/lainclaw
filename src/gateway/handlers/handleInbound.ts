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
  memory?: boolean;
  debug?: boolean;
  userId?: string;
  newSession?: boolean;
}

interface HandleInboundOptions {
  runtime: AgentRuntimeContext;
  policyConfig?: unknown;
  timeoutMs?: number;
  onFailureHint?: (rawMessage: string) => string;
  runAgentFn?: typeof runAgent;
}

interface InboundBuiltinCommand {
  kind: 'new-session';
  replyText: string;
}

export function resolveBuiltinInboundCommand(input: string): InboundBuiltinCommand | undefined {
  const normalized = input.trim();
  if (normalized === '/new') {
    return {
      kind: 'new-session',
      replyText: '已为你开启新会话。接下来我会按新的上下文继续。',
    };
  }
  return undefined;
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
    const runtime = message.actorId.trim()
      ? {
        ...options.runtime,
        userId: message.actorId.trim(),
      }
      : options.runtime;
    const builtinCommand = resolveBuiltinInboundCommand(input);
    if (builtinCommand?.kind === 'new-session') {
      await runAgentWithTimeout({
        input,
        channelId: message.channel,
        sessionKey,
        runtime: {
          ...runtime,
          newSession: true,
        },
        timeoutMs: options.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS,
        runAgentFn: options.runAgentFn,
      });

      return {
        requestId: message.requestId,
        replyTo: message.replyTo,
        text: builtinCommand.replyText,
      };
    }

    const responseText = await runAgentWithTimeout({
      input,
      channelId: message.channel,
      sessionKey,
      runtime,
      timeoutMs: options.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS,
      runAgentFn: options.runAgentFn,
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
  runAgentFn?: typeof runAgent;
}

async function runAgentWithTimeout(params: AgentRequest): Promise<string> {
  const timeoutMs = Number.isFinite(params.timeoutMs) && params.timeoutMs > 0
    ? params.timeoutMs
    : DEFAULT_AGENT_TIMEOUT_MS;

  const runAgentFn = params.runAgentFn ?? runAgent;
  const invoke = runAgentFn({
    input: params.input,
    channelId: params.channelId,
    sessionKey: params.sessionKey,
    runtime: {
      provider: params.runtime.provider,
      profileId: params.runtime.profileId,
      withTools: params.runtime.withTools,
      memory: params.runtime.memory,
      debug: params.runtime.debug,
      userId: params.runtime.userId,
      newSession: params.runtime.newSession,
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
