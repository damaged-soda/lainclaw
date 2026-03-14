import {
  type InboundMessage,
  type OutboundMessage,
} from '../../channels/contracts.js';
import { evaluateAccessPolicy } from './policy/accessPolicy.js';
import { runAgent } from '../index.js';
import {
  buildInboundFailureText,
  runInboundAgentTurn,
} from './inboundAgent.js';

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
  onFailureHint?: (rawMessage: string) => string;
  runAgentFn?: typeof runAgent;
}

export async function handleInbound(
  inbound: InboundMessage,
  options: HandleInboundOptions,
): Promise<OutboundMessage | void> {
  if (inbound.kind !== 'message') {
    return;
  }
  const message = inbound;

  const input = message.text.trim();
  if (!input) {
    return;
  }

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
    const result = await runInboundAgentTurn({
      inbound: message,
      runtime: options.runtime,
      runAgentFn: options.runAgentFn,
    });

    return {
      requestId: result.requestId,
      replyTo: result.replyTo,
      text: result.text,
    };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    return {
      requestId: message.requestId,
      replyTo: message.replyTo,
      text: buildInboundFailureText(message, rawMessage, options.onFailureHint),
    };
  }
}

export { resolveBuiltinInboundCommand } from './inboundAgent.js';
