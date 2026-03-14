import { inspectHeartbeatTargetOpenId } from './diagnostics.js';
import { makeFeishuRequestFailureHint } from './failureHints.js';
import { validateFeishuGatewayCredentials } from './credentials.js';
import { startFeishuHeartbeatSidecar } from './sidecars/heartbeat.js';
import { resolveFeishuGatewayConfig, type FeishuGatewayConfig } from './config.js';
import { runFeishuTransport } from './transport.js';
import { runFeishuInbound } from './inbound.js';
import { type Channel, type ChannelRunContext, type SidecarHandle } from '../contracts.js';
import { sendFeishuTextMessage } from './outbound.js';

interface FeishuRuntimeOptions {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  memory?: boolean;
  debug?: boolean;
}

function normalizeFeishuOverrides(overrides: unknown): Partial<FeishuGatewayConfig> {
  if (!overrides || typeof overrides !== 'object') {
    return {};
  }
  return overrides as Partial<FeishuGatewayConfig>;
}

async function toRuntimeConfig(overrides: unknown, context?: ChannelRunContext): Promise<FeishuGatewayConfig> {
  const channel = context?.channel ?? 'feishu';
  return resolveFeishuGatewayConfig(normalizeFeishuOverrides(overrides), channel);
}

function buildRunInboundRuntime(config: FeishuGatewayConfig, context?: ChannelRunContext): FeishuRuntimeOptions {
  return {
    provider: config.provider,
    profileId: config.profileId,
    withTools: config.withTools,
    memory: config.memory,
    ...(context?.debug === true ? { debug: true } : {}),
  };
}

async function runCoreInbound(
  inbound: Parameters<typeof runFeishuInbound>[0]['inbound'],
  config: FeishuGatewayConfig,
  context?: ChannelRunContext,
): ReturnType<typeof runFeishuInbound> {
  return runFeishuInbound({
    inbound,
    runtime: buildRunInboundRuntime(config, context),
    outbound: {
      sendText: async (replyTo, text) => {
        await sendFeishuTextMessage(config, {
          openId: replyTo,
          text,
        });
      },
    },
    policyConfig: config,
    onFailureHint: makeFeishuRequestFailureHint,
    debug: context?.debug === true,
  });
}

async function resolveRuntimeConfigForSendText(
  meta?: unknown,
): Promise<FeishuGatewayConfig> {
  const candidate = (meta && typeof meta === 'object' ? meta : undefined) as {
    runtimeConfig?: unknown;
  } | undefined;
  if (candidate && candidate.runtimeConfig && typeof candidate.runtimeConfig === 'object') {
    return toRuntimeConfig(candidate.runtimeConfig, { channel: 'feishu' } as ChannelRunContext);
  }
  return toRuntimeConfig({}, { channel: 'feishu' } as ChannelRunContext);
}

export const feishuChannel: Channel = {
  id: 'feishu',
  preflight: async (overrides?: unknown, context?: ChannelRunContext): Promise<FeishuGatewayConfig> => {
    const config = await toRuntimeConfig(overrides, context);
    validateFeishuGatewayCredentials(config);
    if (config.heartbeatEnabled && !config.heartbeatTargetOpenId) {
      throw new Error('Missing value for heartbeat-target-open-id');
    }
    if (config.heartbeatEnabled && config.heartbeatTargetOpenId) {
      const targetDiagnostic = inspectHeartbeatTargetOpenId(config.heartbeatTargetOpenId);
      if (typeof targetDiagnostic.warning === 'string' && targetDiagnostic.warning.length > 0) {
        if (targetDiagnostic.kind === 'unknown') {
          console.warn(`[heartbeat] ${targetDiagnostic.warning}`);
        } else {
          console.info(`[heartbeat] ${targetDiagnostic.warning}`);
        }
      }
    }
    return config;
  },
  sendText: async (replyTo, text, meta): Promise<void> => {
    if (!replyTo || !text.trim()) {
      return;
    }
    const config = await resolveRuntimeConfigForSendText(meta);
    await sendFeishuTextMessage(config, {
      openId: replyTo,
      text,
    });
  },
  run: async (onInbound, overrides?: unknown, context?: ChannelRunContext): Promise<void> => {
    const config = await toRuntimeConfig(overrides, context);

    const runInbound = async (inbound: Parameters<typeof runFeishuInbound>[0]['inbound']) => {
      if (onInbound) {
        const overridden = await onInbound(inbound);
        if (overridden) {
          return overridden;
        }
      }
      return runCoreInbound(inbound, config, context);
    };

    await runFeishuTransport({
      config,
      onInbound: (inbound) => runInbound(inbound),
    });
  },
  startSidecars: async (
    overrides?: unknown,
    context?: ChannelRunContext,
    preflightResult?: unknown,
  ): Promise<SidecarHandle | void> => {
    const config = (preflightResult as FeishuGatewayConfig | undefined)
      ?? (await toRuntimeConfig(overrides, context));
    return startFeishuHeartbeatSidecar({
      config,
      onFailureHint: makeFeishuRequestFailureHint,
      outbound: {
        sendText: (replyTo, text) => feishuChannel.sendText(replyTo, text, { runtimeConfig: config }),
      },
    });
  },
};
