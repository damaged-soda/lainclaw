import {
  buildFeishuGatewayConfigMigrationDraft,
  clearFeishuGatewayConfig,
  loadCachedFeishuGatewayConfigWithSources,
  persistFeishuGatewayConfig,
  resolveFeishuGatewayConfigPath,
  type FeishuGatewayConfig,
  type FeishuGatewayConfigSources,
} from '../../channels/feishu/config.js';
import {
  getGatewayServiceSnapshot,
  resolveGatewayServicePaths,
  stopGatewayService,
  resolveGatewayServiceStatus,
} from '../../gateway/service.js';
import { makeFeishuFailureHint, maskConfigValue } from '../../channels/feishu/diagnostics.js';
import {
  type GatewayParsedCommand,
  type GatewayConfigParsedCommand,
  type GatewayServiceRunContext,
  type GatewayStartOverrides,
  type GatewayFeishuStartOverrides,
  type GatewayLocalStartOverrides,
  type GatewayChannel,
} from './contracts.js';
import { normalizeGatewayChannels, resolveGatewayChannel } from './channelRegistry.js';
import { runFeishuGatewayWithHeartbeat } from './channels/feishu.js';
import { runLocalGatewayService } from './channels/local.js';
import { runGatewayServiceRunner } from './serviceRunner.js';
import { resolveFeishuGatewayRuntimeConfig } from './channels/feishu.js';

interface GatewayRuntimeEntry {
  start: (overrides: GatewayStartOverrides, serviceContext: GatewayServiceRunContext) => Promise<void>;
  validate?: (overrides: GatewayStartOverrides, channel: GatewayChannel) => Promise<void>;
}

const gatewayRuntimes: Record<GatewayChannel, GatewayRuntimeEntry> = {
  feishu: {
    start: (overrides, serviceContext) =>
      runFeishuGatewayWithHeartbeat(
        overrides as GatewayFeishuStartOverrides,
        makeFeishuFailureHint,
        serviceContext,
      ),
    validate: async (overrides) => {
      await resolveFeishuGatewayRuntimeConfig(overrides as GatewayFeishuStartOverrides, 'feishu');
    },
  },
  local: {
    start: (overrides, serviceContext) =>
      runLocalGatewayService(overrides as GatewayLocalStartOverrides, serviceContext),
  },
};

export async function runGatewayStart(parsed: GatewayParsedCommand): Promise<number> {
  const {
    channel,
    channels,
    action,
    daemon,
    statePath,
    logPath,
    serviceChild,
    debug,
    serviceArgv,
    ...gatewayOptions
  } = parsed;
  if (action !== 'start') {
    throw new Error(`Unsupported gateway action: ${action}`);
  }

  if (channels.length > 1) {
    await runGatewayServiceForChannels(
      gatewayOptions as GatewayStartOverrides,
      {
        channel,
        channels,
        action,
        debug,
        serviceChild,
        daemon,
        statePath,
        logPath,
        serviceArgv,
      },
      channels,
    );
    return 0;
  }

  const runtimeChannel = resolveGatewayChannel(channel);
  const runtime = gatewayRuntimes[runtimeChannel];

  await runtime.start(
    normalizeGatewayRuntimeOverrides(gatewayOptions as GatewayStartOverrides, runtimeChannel),
    {
      channel,
      action,
      debug,
      serviceChild,
      daemon,
      statePath,
      logPath,
      serviceArgv,
    },
  );
  return 0;
}

export async function runGatewayStatusOrStop(
  parsed: GatewayParsedCommand,
  action: 'status' | 'stop',
): Promise<number> {
  await runGatewayServiceLifecycleAction({
    channel: 'gateway',
    action,
    serviceChild: parsed.serviceChild,
    daemon: parsed.daemon,
    statePath: parsed.statePath,
    logPath: parsed.logPath,
    serviceArgv: parsed.serviceArgv,
  });
  return 0;
}

export async function runGatewayConfigCommand(parsed: GatewayConfigParsedCommand): Promise<number> {
  if (parsed.action === 'set') {
    if (Object.keys(parsed.config).length === 0) {
      throw new Error('No gateway config fields provided');
    }
    await persistFeishuGatewayConfig(parsed.config, parsed.channel);
    console.log('gateway config updated');
    return 0;
  }

  if (parsed.action === 'clear') {
    await clearFeishuGatewayConfig(parsed.channel);
    console.log('gateway config cleared');
    return 0;
  }

  if (parsed.action === 'migrate') {
    const draft = await buildFeishuGatewayConfigMigrationDraft(
      parsed.channelProvided ? parsed.channel : undefined,
    );
    console.log(JSON.stringify(draft, null, 2));
    return 0;
  }

  const { config: cached, sources } = await loadCachedFeishuGatewayConfigWithSources(parsed.channel);
  const configPath = resolveFeishuGatewayConfigPath(parsed.channel);
  const config = Object.fromEntries(
    Object.entries(cached).map((entry) => {
      const key = entry[0];
      const value = entry[1];
      if (typeof value === 'string' && (key === 'appId' || key === 'appSecret')) {
        return [
          key,
          {
            value: maskConfigValue(value),
            source: sources[key as keyof FeishuGatewayConfigSources],
          },
        ];
      }
      return [
        key,
        {
          value,
          source: sources[key as keyof FeishuGatewayConfigSources],
        },
      ];
    }),
  );
  const masked = {
    channel: parsed.channel,
    configPath,
    config,
  };
  console.log(JSON.stringify(masked, null, 2));
  return 0;
}

export async function runGatewayServiceLifecycleAction(
  serviceContext: GatewayServiceRunContext,
): Promise<void> {
  const paths = resolveGatewayServicePaths(serviceContext.channel, {
    statePath: serviceContext.statePath,
    logPath: serviceContext.logPath,
  });

  if (serviceContext.action === 'status') {
    await resolveGatewayServiceStatus(paths);
    return;
  }
  if (serviceContext.action !== 'stop') {
    throw new Error(`Unsupported gateway action: ${serviceContext.action}`);
  }

  const snapshot = await getGatewayServiceSnapshot(paths);
  if (!snapshot.state || !snapshot.running) {
    console.log('gateway service already stopped');
    return;
  }
  await stopGatewayService(paths, snapshot.state);
  console.log(`gateway service stopped (pid=${snapshot.state.pid})`);
}

export async function runGatewayServiceForChannels(
  overrides: GatewayStartOverrides,
  serviceContext: GatewayServiceRunContext,
  channels: GatewayChannel[],
): Promise<void> {
  const normalizedChannels = normalizeGatewayChannels(channels);
  if (normalizedChannels.length === 0) {
    throw new Error('At least one gateway channel is required');
  }

  if (serviceContext.daemon) {
    for (const channel of normalizedChannels) {
      const runtime = gatewayRuntimes[channel];
      await runtime.validate?.(overrides, channel);
    }

    await runGatewayServiceRunner({
      serviceContext: {
        ...serviceContext,
        channel: 'gateway',
      },
      stateChannel: 'gateway',
      stateChannels: normalizedChannels,
      runInProcess: async () => Promise.resolve(),
    });
    return;
  }

  const startedChannels = normalizedChannels.map((channel) => {
    const runtime = gatewayRuntimes[channel];
    const nextOverrides = normalizeGatewayRuntimeOverrides(overrides, channel);
    return runtime.start(nextOverrides, {
      ...serviceContext,
      channel,
    });
  });

  await Promise.all(startedChannels);
}

function normalizeGatewayRuntimeOverrides(
  overrides: GatewayStartOverrides,
  channel: GatewayChannel,
): GatewayFeishuStartOverrides | GatewayLocalStartOverrides {
  if (channel === 'feishu') {
    return overrides as GatewayFeishuStartOverrides;
  }
  return overrides as GatewayLocalStartOverrides;
}

export { runFeishuGatewayWithHeartbeat, runLocalGatewayService };

export function printGatewayServiceStatus(
  paths: { statePath: string; logPath: string },
  channel = 'gateway',
): Promise<void> {
  return resolveGatewayServiceStatus(paths, channel);
}
