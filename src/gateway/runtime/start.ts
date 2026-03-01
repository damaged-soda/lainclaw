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
  spawnGatewayServiceProcess,
  type GatewayServicePaths,
  type GatewayServiceState,
  resolveGatewayServiceStatus,
  stopGatewayService,
  writeGatewayServiceState,
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
import {
  resolveFeishuGatewayRuntimeConfig,
  runFeishuGatewayWithHeartbeat,
} from './channels/feishu.js';
import { runLocalGatewayService } from './channels/local.js';

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
  if (runtimeChannel === 'feishu') {
    await runFeishuGatewayWithHeartbeat(
      gatewayOptions as GatewayFeishuStartOverrides,
      makeFeishuFailureHint,
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

  await runLocalGatewayService(gatewayOptions as GatewayLocalStartOverrides, {
    channel,
    action,
    debug,
    serviceChild,
    daemon,
    statePath,
    logPath,
    serviceArgv,
  });
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
    await printGatewayServiceStatus(paths);
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
    const paths = resolveGatewayServicePaths('gateway', {
      statePath: serviceContext.statePath,
      logPath: serviceContext.logPath,
    });
    const snapshot = await getGatewayServiceSnapshot(paths);
    if (snapshot.running) {
      throw new Error(`Gateway already running (pid=${snapshot.state?.pid})`);
    }

    for (const channel of normalizedChannels) {
      if (channel === 'feishu') {
        await resolveFeishuGatewayRuntimeConfig(
          normalizeGatewayRuntimeOverrides(overrides, channel),
          channel,
        );
        continue;
      }
    }

    const daemonArgv = ['gateway', 'start', ...serviceContext.serviceArgv, '--service-child'];
    const scriptPath = process.argv[1];
    if (!scriptPath) {
      throw new Error('Cannot locate service entrypoint');
    }

    const daemonPid = await spawnGatewayServiceProcess(scriptPath, daemonArgv, paths);
    const daemonState: GatewayServiceState = {
      channel: 'gateway',
      channels: normalizedChannels,
      pid: daemonPid,
      startedAt: new Date().toISOString(),
      command: `${process.execPath} ${scriptPath} ${daemonArgv.join(' ')}`.trim(),
      statePath: paths.statePath,
      logPath: paths.logPath,
      argv: [scriptPath, ...daemonArgv],
    };
    await writeGatewayServiceState(daemonState);
    console.log(`gateway service started as daemon: pid=${daemonPid}`);
    console.log(`status: ${paths.statePath}`);
    console.log(`log: ${paths.logPath}`);
    return;
  }

  const startedChannels = normalizedChannels.map((channel) => {
    if (channel === 'feishu') {
      return runFeishuGatewayWithHeartbeat(
        normalizeGatewayRuntimeOverrides(overrides, channel),
        makeFeishuFailureHint,
        {
          ...serviceContext,
          channel,
        },
      );
    }
    return runLocalGatewayService(
      normalizeGatewayRuntimeOverrides(overrides, channel),
      {
        ...serviceContext,
        channel,
      },
    );
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
  paths: GatewayServicePaths,
  channel = 'gateway',
): Promise<void> {
  return resolveGatewayServiceStatus(paths, channel);
}
