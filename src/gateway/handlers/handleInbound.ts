import {
  type InboundMessage,
  type OutboundMessage,
} from '../../channels/contracts.js';
import { runAgent } from '../../agent/invoke.js';
import {
  buildInboundFailureText,
  runInboundAgentTurn,
} from './inboundAgent.js';
import type { RuntimeAgentEventSink } from '../../shared/types.js';
import type { GatewayAgentRuntimeContext } from '../runtimeConfig.js';

interface HandleInboundOptions {
  runtime: GatewayAgentRuntimeContext;
  onFailureHint?: (rawMessage: string) => string;
  onAgentEvent?: RuntimeAgentEventSink;
  runAgentFn?: typeof runAgent;
}

export async function handleInbound(
  inbound: InboundMessage,
  options: HandleInboundOptions,
): Promise<OutboundMessage | void> {
  try {
    if (inbound.kind !== 'message') {
      return;
    }

    const input = inbound.text.trim();
    if (!input) {
      return;
    }

    const result = await runInboundAgentTurn({
      inbound,
      runtime: options.runtime,
      ...(options.onAgentEvent ? { onAgentEvent: options.onAgentEvent } : {}),
      runAgentFn: options.runAgentFn,
    });

    return {
      requestId: result.requestId,
      replyTo: result.replyTo,
      text: result.text,
    };
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
