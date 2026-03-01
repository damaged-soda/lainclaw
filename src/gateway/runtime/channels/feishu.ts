import { runFeishuGatewayServer } from '../../../channels/feishu/server.js';
import { validateFeishuGatewayCredentials } from '../../../channels/feishu/credentials.js';
import { inspectHeartbeatTargetOpenId } from '../../../channels/feishu/diagnostics.js';
import {
  resolveFeishuGatewayConfig,
  type FeishuGatewayConfig,
} from '../../../channels/feishu/config.js';
import { makeFeishuFailureHint } from '../../../channels/feishu/diagnostics.js';
import { runGatewayServiceRunner } from '../serviceRunner.js';
import { startFeishuHeartbeatSidecar } from '../sidecars/heartbeat.js';
import { type GatewayChannel, type GatewayServiceRunContext } from '../contracts.js';

export async function runFeishuGatewayWithHeartbeat(
  overrides: Partial<FeishuGatewayConfig>,
  onFailureHint: (rawMessage: string) => string,
  serviceContext: GatewayServiceRunContext = {
    channel: 'feishu',
    serviceArgv: [],
  },
): Promise<void> {
  const effectiveChannel: GatewayChannel = serviceContext.channel === 'gateway' ? 'feishu' : serviceContext.channel;

  const runForeground = async (): Promise<void> => {
    const config = await resolveFeishuGatewayRuntimeConfig(overrides, effectiveChannel);
    const heartbeatHandle = startFeishuHeartbeatSidecar(config, onFailureHint || makeFeishuFailureHint);
    try {
      await runFeishuGatewayServer(
        overrides,
        {
          onFailureHint: onFailureHint || makeFeishuFailureHint,
        },
        effectiveChannel,
      );
    } finally {
      heartbeatHandle?.stop();
    }
  };

  await runGatewayServiceRunner({
    serviceContext: {
      ...serviceContext,
      channel: effectiveChannel,
    },
    stateChannel: effectiveChannel,
    runInProcess: runForeground,
    preflight: async () => {
      await resolveFeishuGatewayRuntimeConfig(overrides, effectiveChannel);
    },
  });
}

export async function resolveFeishuGatewayRuntimeConfig(
  overrides: Partial<FeishuGatewayConfig>,
  channel: GatewayChannel,
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
