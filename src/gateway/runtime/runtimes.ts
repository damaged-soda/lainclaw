import { runFeishuGatewayServer } from '../../channels/feishu/server.js';
import { validateFeishuGatewayCredentials } from '../../channels/feishu/credentials.js';
import { inspectHeartbeatTargetOpenId } from '../../channels/feishu/diagnostics.js';
import { resolveFeishuGatewayConfig, type FeishuGatewayConfig } from '../../channels/feishu/config.js';
import { makeFeishuFailureHint } from '../../channels/feishu/diagnostics.js';
import { runGatewayServiceRunner } from './serviceRunner.js';
import { startFeishuHeartbeatSidecar } from './sidecars/heartbeat.js';
import { runLocalGatewayServer, type LocalGatewayOverrides } from '../../channels/local/server.js';
import type { GatewayServiceRunContext } from './contracts.js';

export interface GatewayRuntimeEntry {
  start: (overrides: unknown, serviceContext: GatewayServiceRunContext) => Promise<void>;
  validate?: (overrides: unknown, channel: string) => Promise<void>;
}

export const gatewayRuntimes = {
  feishu: {
    start: (overrides, serviceContext) =>
      runFeishuGatewayWithHeartbeat(
        overrides as Partial<FeishuGatewayConfig>,
        makeFeishuFailureHint,
        serviceContext,
      ),
    validate: async (overrides) => {
      await resolveFeishuGatewayRuntimeConfig(
        overrides as Partial<FeishuGatewayConfig>,
        'feishu',
      );
    },
  },
  local: {
    start: (overrides, serviceContext) =>
      runLocalGatewayService(
        overrides as Partial<LocalGatewayOverrides>,
        serviceContext,
      ),
  },
} satisfies Record<string, GatewayRuntimeEntry>;

export type GatewayRuntimeChannel = keyof typeof gatewayRuntimes;

export async function runFeishuGatewayWithHeartbeat(
  overrides: Partial<FeishuGatewayConfig>,
  onFailureHint: (rawMessage: string) => string,
  serviceContext: GatewayServiceRunContext = {
    channel: 'feishu',
    serviceArgv: [],
  },
): Promise<void> {
  const effectiveChannel = serviceContext.channel === 'gateway' ? 'feishu' : serviceContext.channel;

  const runForeground = async (): Promise<void> => {
    const config = await resolveFeishuGatewayRuntimeConfig(
      overrides,
      effectiveChannel as string,
    );
    const heartbeatHandle = startFeishuHeartbeatSidecar(
      config,
      onFailureHint || makeFeishuFailureHint,
    );
    try {
      await runFeishuGatewayServer(
        overrides,
        {
          onFailureHint: onFailureHint || makeFeishuFailureHint,
        },
        effectiveChannel as 'feishu' | 'local',
      );
    } finally {
      heartbeatHandle?.stop();
    }
  };

  await runGatewayServiceRunner({
    serviceContext: {
      ...serviceContext,
      channel: effectiveChannel as 'feishu' | 'local' | 'gateway',
    },
    stateChannel: effectiveChannel as 'feishu' | 'local' | 'gateway',
    runInProcess: runForeground,
    preflight: async () => {
      await resolveFeishuGatewayRuntimeConfig(overrides, effectiveChannel as string);
    },
  });
}

export async function runLocalGatewayService(
  overrides: Partial<LocalGatewayOverrides>,
  serviceContext: GatewayServiceRunContext = {
    channel: 'local',
    serviceArgv: [],
  },
): Promise<void> {
  const context: GatewayServiceRunContext = {
    ...serviceContext,
    channel: serviceContext.channel ?? 'local',
    serviceArgv: serviceContext.serviceArgv ?? [],
  };

  await runGatewayServiceRunner({
    serviceContext: context,
    stateChannel: context.channel === 'gateway' ? 'local' : context.channel as 'feishu' | 'local',
    runInProcess: async () => {
      await runLocalGatewayServer(overrides, { debug: context.debug });
    },
  });
}

export async function resolveFeishuGatewayRuntimeConfig(
  overrides: Partial<FeishuGatewayConfig>,
  channel: string,
): Promise<FeishuGatewayConfig> {
  const config = await resolveFeishuGatewayConfig(overrides, channel);
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
}
