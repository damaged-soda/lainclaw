import type {
  InboundMessage,
  MessageInboundMessage,
  ChannelOutboundTextCapability,
} from '../contracts.js';
import { runAgent } from '../../gateway/index.js';
import { evaluateAccessPolicy } from '../../gateway/handlers/policy/accessPolicy.js';
import {
  buildInboundFailureText,
  resolveSessionKey,
  runInboundAgentTurn,
} from '../../gateway/handlers/inboundAgent.js';
import {
  createFeishuTurnController,
  type FeishuTurnController,
} from './turnController.js';

const DEFAULT_FEISHU_SLOW_ACK_DELAY_MS = 3000;

interface FeishuInboundRuntimeOptions {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  memory?: boolean;
  debug?: boolean;
}

export interface RunFeishuInboundOptions {
  inbound: InboundMessage;
  runtime: FeishuInboundRuntimeOptions;
  outbound: ChannelOutboundTextCapability;
  policyConfig?: unknown;
  onFailureHint?: (rawMessage: string) => string;
  runAgentFn?: typeof runAgent;
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
  try {
    await controller.fail(buildInboundFailureText(inbound, rawMessage, onFailureHint));
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

  const decision = await evaluateAccessPolicy({
    inbound,
    config: options.policyConfig,
  });

  if (!decision.allowed) {
    if (!decision.replyText) {
      return;
    }
    await options.outbound.sendText(inbound.replyTo, decision.replyText);
    return;
  }

  const controller = createFeishuTurnController({
    requestId: inbound.requestId,
    sessionKey: resolveSessionKey(inbound),
    replyTo: inbound.replyTo,
    slowAckDelayMs: options.slowAckDelayMs ?? DEFAULT_FEISHU_SLOW_ACK_DELAY_MS,
    outbound: options.outbound,
    debug: options.debug === true,
  });

  try {
    let result: Awaited<ReturnType<typeof runInboundAgentTurn>>;
    try {
      result = await runInboundAgentTurn({
        inbound,
        runtime: options.runtime,
        runAgentFn: options.runAgentFn,
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
