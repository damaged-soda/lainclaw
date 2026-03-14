import {
  type Channel,
  type ChannelOutboundTextCapability,
  type ChannelRunContext,
  type InboundHandler,
  type SidecarHandle,
} from '../channels/contracts.js';
import {
  type FeishuChannelConfig,
  resolveFeishuChannelConfig,
} from '../channels/feishu/config.js';
import { makeFeishuRequestFailureHint } from '../channels/feishu/failureHints.js';
import { runFeishuInbound } from '../channels/feishu/inbound.js';
import { handleInbound, runInboundPipeline } from './handlers/handleInbound.js';
import type { GatewayChannel, GatewayStartOverrides } from './commands/contracts.js';
import {
  resolveGatewayRuntimeConfig,
  type GatewayAgentRuntimeContext,
  type GatewayRuntimeConfig,
} from './runtimeConfig.js';
import { startHeartbeatSidecar } from './sidecars/heartbeat.js';

export interface ResolvedGatewayChannelBinding {
  channelConfig?: unknown;
  runtimeConfig: GatewayRuntimeConfig;
  inboundHandler: InboundHandler;
  startSidecars?: (preflightResult?: unknown) => Promise<SidecarHandle | void> | SidecarHandle | void;
}

function bindChannelOutboundText(
  channel: Channel,
  config: unknown,
): ChannelOutboundTextCapability | undefined {
  if (!channel.sendText) {
    return undefined;
  }
  return {
    sendText: (replyTo, text, options) => channel.sendText?.(
      replyTo,
      text,
      {
        ...(options ?? {}),
        config: options?.config ?? config,
      },
    ) ?? Promise.resolve(),
  };
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
    throw new Error('Feishu channel is missing sendText capability');
  }

  return {
    channelConfig,
    runtimeConfig,
    inboundHandler: async (inbound) => {
      await runFeishuInbound({
        inbound,
        outbound,
        onFailureHint: makeFeishuRequestFailureHint,
        debug: context?.debug === true,
        handleTurn: async ({ inbound: message, onAgentEvent }) => {
          const outboundMessage = await runInboundPipeline(message, {
            runtime,
            policyConfig: channelConfig,
            onAgentEvent,
          });
          return outboundMessage ? { text: outboundMessage.text } : undefined;
        },
      });
      return undefined;
    },
    startSidecars: (preflightResult?: unknown) => {
      const nextChannelConfig = (preflightResult as FeishuChannelConfig | undefined) ?? channelConfig;
      return startHeartbeatSidecar({
        outbound,
        enabled: nextChannelConfig.heartbeatEnabled,
        provider: runtimeConfig.provider,
        ...(typeof runtimeConfig.profileId === 'string' && runtimeConfig.profileId.trim()
          ? { profileId: runtimeConfig.profileId.trim() }
          : {}),
        withTools: runtimeConfig.withTools,
        memory: runtimeConfig.memory,
        targetReplyTo: nextChannelConfig.heartbeatTargetOpenId,
        sessionKey: nextChannelConfig.heartbeatSessionKey,
        intervalMs: nextChannelConfig.heartbeatIntervalMs,
        onFailureHint: makeFeishuRequestFailureHint,
      });
    },
  };
}

async function resolveLocalBinding(
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
    inboundHandler: (inbound) => handleInbound(inbound, {
      runtime,
      policyConfig: overrides?.channelConfig,
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
  return resolveLocalBinding(overrides, context);
}
