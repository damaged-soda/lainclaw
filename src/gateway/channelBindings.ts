import {
  type Channel,
  type ChannelSendText,
  type ChannelRunContext,
  type InboundHandler,
} from '../channels/contracts.js';
import {
  type FeishuChannelConfig,
  resolveFeishuChannelConfig,
} from '../channels/feishu/config.js';
import { makeFeishuRequestFailureHint } from '../channels/feishu/failureHints.js';
import { runFeishuInbound } from '../channels/feishu/inbound.js';
import {
  buildFeishuPairingReply,
  isFeishuPaired,
  issueFeishuPairingCode,
} from '../channels/feishu/pairing.js';
import { handleInbound } from './handlers/handleInbound.js';
import type { GatewayChannel, GatewayStartOverrides } from './commands/contracts.js';
import {
  resolveGatewayRuntimeConfig,
  type GatewayAgentRuntimeContext,
  type GatewayRuntimeConfig,
} from './runtimeConfig.js';

export interface ResolvedGatewayChannelBinding {
  channelConfig?: unknown;
  runtimeConfig: GatewayRuntimeConfig;
  inboundHandler: InboundHandler;
  outbound?: ChannelSendText;
}

function bindChannelOutboundText(
  channel: Channel,
  config: unknown,
): ChannelSendText | undefined {
  if (!channel.sendText) {
    return undefined;
  }
  return (replyTo, text, options) => channel.sendText?.(
    replyTo,
    text,
    {
      ...(options ?? {}),
      config: options?.config ?? config,
    },
  ) ?? Promise.resolve();
}

async function resolveFeishuBinding(
  channel: Channel,
  overrides: GatewayStartOverrides | undefined,
  context?: ChannelRunContext,
): Promise<ResolvedGatewayChannelBinding> {
  const channelConfig = await resolveFeishuChannelConfig(
    overrides?.channelConfig as Partial<FeishuChannelConfig> | undefined,
    context?.channel ?? 'feishu',
  );
  const runtimeConfig = await resolveGatewayRuntimeConfig(overrides?.runtimeConfig);
  const runtime: GatewayAgentRuntimeContext = {
    ...runtimeConfig,
    ...(context?.debug === true ? { debug: true } : {}),
  };
  const outbound = bindChannelOutboundText(channel, channelConfig);
  if (!outbound) {
    throw new Error('Feishu channel is missing sendText');
  }

  return {
    channelConfig,
    runtimeConfig,
    outbound,
    inboundHandler: async (inbound) => {
      await runFeishuInbound({
        inbound,
        outbound,
        onFailureHint: makeFeishuRequestFailureHint,
        debug: context?.debug === true,
        handleTurn: async ({ inbound: message, onAgentEvent }) => {
          const actorId = message.actorId.trim();
          if (!actorId) {
            return {
              text: '当前消息缺少用户标识，无法完成 pairing。',
            };
          }

          const paired = await isFeishuPaired(actorId);
          if (!paired) {
            const { code } = await issueFeishuPairingCode(actorId);
            return {
              text: buildFeishuPairingReply(actorId, code),
            };
          }

          const outboundMessage = await handleInbound(message, {
            runtime,
            onAgentEvent,
          });
          return outboundMessage ? { text: outboundMessage.text } : undefined;
        },
      });
      return undefined;
    },
  };
}

async function resolveLocalBinding(
  channel: Channel,
  overrides: GatewayStartOverrides | undefined,
  context?: ChannelRunContext,
): Promise<ResolvedGatewayChannelBinding> {
  const runtimeConfig = await resolveGatewayRuntimeConfig(overrides?.runtimeConfig);
  const runtime: GatewayAgentRuntimeContext = {
    ...runtimeConfig,
    ...(context?.debug === true ? { debug: true } : {}),
  };
  return {
    channelConfig: overrides?.channelConfig,
    runtimeConfig,
    outbound: bindChannelOutboundText(channel, overrides?.channelConfig),
    inboundHandler: (inbound) => handleInbound(inbound, {
      runtime,
    }),
  };
}

export async function resolveGatewayChannelBinding(
  channelId: GatewayChannel,
  channel: Channel,
  overrides: GatewayStartOverrides | undefined,
  context?: ChannelRunContext,
): Promise<ResolvedGatewayChannelBinding> {
  if (channelId === 'feishu') {
    return resolveFeishuBinding(channel, overrides, context);
  }
  return resolveLocalBinding(channel, overrides, context);
}
