import type {
  InboundMessage,
  MessageInboundMessage,
  ChannelOutboundTextCapability,
} from '../contracts.js';
import type { RuntimeAgentEventSink } from '../../shared/types.js';
import {
  createFeishuTurnController,
  type FeishuTurnController,
} from './turnController.js';

const DEFAULT_FEISHU_SLOW_ACK_DELAY_MS = 3000;

export interface FeishuInboundTurnRequest {
  inbound: MessageInboundMessage;
  onAgentEvent?: RuntimeAgentEventSink;
}

export interface FeishuInboundTurnResult {
  text: string;
}

export interface RunFeishuInboundOptions {
  inbound: InboundMessage;
  outbound: ChannelOutboundTextCapability;
  handleTurn: (request: FeishuInboundTurnRequest) => Promise<FeishuInboundTurnResult | void>;
  onFailureHint?: (rawMessage: string) => string;
  slowAckDelayMs?: number;
  debug?: boolean;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wrapDeliveryError(message: string, cause: unknown): Error {
  return new Error(message, {
    cause: cause instanceof Error ? cause : new Error(describeError(cause)),
  });
}

async function sendFailureReply(
  controller: FeishuTurnController,
  inbound: MessageInboundMessage,
  error: unknown,
  onFailureHint: ((rawMessage: string) => string) | undefined,
  failureContext: string,
): Promise<void> {
  const rawMessage = describeError(error);
  const hint = onFailureHint ? onFailureHint(rawMessage) : rawMessage;
  try {
    await controller.fail(`[Lainclaw] ${hint}（requestId: ${inbound.requestId}）`);
  } catch (sendError) {
    throw wrapDeliveryError(`${failureContext}: ${rawMessage}`, sendError);
  }
}

export async function runFeishuInbound(options: RunFeishuInboundOptions): Promise<void> {
  const { inbound } = options;
  if (inbound.kind !== 'message') {
    return;
  }

  const input = inbound.text.trim();
  if (!input) {
    return;
  }

  const controller = createFeishuTurnController({
    requestId: inbound.requestId,
    sessionKey: `${inbound.actorId.trim() || inbound.requestId}:${inbound.conversationId.trim() || inbound.requestId}`,
    replyTo: inbound.replyTo,
    slowAckDelayMs: options.slowAckDelayMs ?? DEFAULT_FEISHU_SLOW_ACK_DELAY_MS,
    outbound: options.outbound,
    debug: options.debug === true,
  });

  try {
    let result: FeishuInboundTurnResult | void;
    try {
      result = await options.handleTurn({
        inbound,
        onAgentEvent: async (event) => controller.onAgentEvent(event),
      });
    } catch (error) {
      await sendFailureReply(
        controller,
        inbound,
        error,
        options.onFailureHint,
        'agent turn failed and Feishu failure reply could not be delivered',
      );
      return;
    }

    if (!result) {
      return;
    }

    try {
      await controller.complete(result.text);
    } catch (error) {
      await sendFailureReply(
        controller,
        inbound,
        error,
        options.onFailureHint,
        'failed to send Feishu fallback reply after final reply send failure',
      );
      throw wrapDeliveryError(`failed to send Feishu final reply: ${describeError(error)}`, error);
    }
  } finally {
    controller.dispose();
  }
}
