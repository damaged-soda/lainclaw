import { inspectHeartbeatTargetOpenId } from './diagnostics.js';
import { validateFeishuGatewayCredentials } from './credentials.js';
import { startFeishuHeartbeatSidecar } from './sidecars/heartbeat.js';
import { resolveFeishuGatewayConfig, type FeishuGatewayConfig } from './config.js';
import { runFeishuTransport } from './transport.js';
import { handleInbound } from '../../gateway/handlers/handleInbound.js';
import { makeFeishuFailureHint } from './diagnostics.js';
import { type Channel, type ChannelRunContext, type SidecarHandle } from '../contracts.js';
import { sendFeishuTextMessage } from './outbound.js';

const DEFAULT_AGENT_TIMEOUT_MS = 10000;

interface FeishuRuntimeOptions {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  memory?: boolean;
  toolAllow?: string[];
}

function normalizeFeishuOverrides(overrides: unknown): Partial<FeishuGatewayConfig> {
  if (!overrides || typeof overrides !== 'object') {
    return {};
  }
  return overrides as Partial<FeishuGatewayConfig>;
}

async function toRuntimeConfig(overrides: unknown, context?: ChannelRunContext): Promise<FeishuGatewayConfig> {
  const integration = context?.integration ?? 'feishu';
  return resolveFeishuGatewayConfig(normalizeFeishuOverrides(overrides), integration);
}

function buildRunInboundRuntime(config: FeishuGatewayConfig): FeishuRuntimeOptions {
  return {
    provider: config.provider,
    profileId: config.profileId,
    withTools: config.withTools,
    memory: config.memory,
    toolAllow: config.toolAllow,
  };
}

async function runCoreInbound(
  inbound: Parameters<typeof handleInbound>[0],
  config: FeishuGatewayConfig,
): ReturnType<typeof handleInbound> {
  return handleInbound(inbound, {
    runtime: buildRunInboundRuntime(config),
    policyConfig: config,
    timeoutMs: config.requestTimeoutMs || DEFAULT_AGENT_TIMEOUT_MS,
    onFailureHint: makeFeishuFailureHint,
  });
}

async function resolveRuntimeConfigForSendText(
  meta?: unknown,
): Promise<FeishuGatewayConfig> {
  const candidate = (meta && typeof meta === 'object' ? meta : undefined) as {
    runtimeConfig?: unknown;
  } | undefined;
  if (candidate && candidate.runtimeConfig && typeof candidate.runtimeConfig === 'object') {
    return toRuntimeConfig(candidate.runtimeConfig, { integration: 'feishu' } as ChannelRunContext);
  }
  return toRuntimeConfig({}, { integration: 'feishu' } as ChannelRunContext);
}

export const feishuIntegration: Channel = {
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

    const runInbound = async (inbound: Parameters<typeof handleInbound>[0]) => {
      if (onInbound) {
        const overridden = await onInbound(inbound);
        if (overridden) {
          return overridden;
        }
      }
      return runCoreInbound(inbound, config);
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
      onFailureHint: makeFeishuFailureHint,
      outbound: {
        sendText: (replyTo, text) => feishuIntegration.sendText(replyTo, text, { runtimeConfig: config }),
      },
    });
  },
};
