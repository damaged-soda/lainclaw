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
import type { RuntimeAgentEventSink } from '../../shared/types.js';
import type { GatewayAgentRuntimeContext } from '../runtimeConfig.js';

interface HandleInboundOptions {
  runtime: GatewayAgentRuntimeContext;
  policyConfig?: unknown;
  onFailureHint?: (rawMessage: string) => string;
  onAgentEvent?: RuntimeAgentEventSink;
  runAgentFn?: typeof runAgent;
}

export async function runInboundPipeline(
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

  const result = await runInboundAgentTurn({
    inbound: message,
    runtime: options.runtime,
    ...(options.onAgentEvent ? { onAgentEvent: options.onAgentEvent } : {}),
    runAgentFn: options.runAgentFn,
  });

  return {
    requestId: result.requestId,
    replyTo: result.replyTo,
    text: result.text,
  };
}

export async function handleInbound(
  inbound: InboundMessage,
  options: HandleInboundOptions,
): Promise<OutboundMessage | void> {
  try {
    return await runInboundPipeline(inbound, options);
  } catch (error) {
    if (inbound.kind !== 'message') {
      return;
    }
    const rawMessage = error instanceof Error ? error.message : String(error);
    return {
      requestId: inbound.requestId,
      replyTo: inbound.replyTo,
      text: buildInboundFailureText(inbound, rawMessage, options.onFailureHint),
    };
  }
}

export { resolveBuiltinInboundCommand } from './inboundAgent.js';
