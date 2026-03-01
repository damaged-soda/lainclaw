import {
  buildFeishuGatewayConfigMigrationDraft,
  clearFeishuGatewayConfig,
  loadCachedFeishuGatewayConfigWithSources,
  persistFeishuGatewayConfig,
  resolveFeishuGatewayConfigPath,
} from '../../integrations/feishu/config.js';
import {
  getGatewayServiceSnapshot,
  resolveGatewayServicePaths,
  stopGatewayService,
  resolveGatewayServiceStatus,
} from '../../gateway/service.js';
import { maskConfigValue } from '../../integrations/feishu/diagnostics.js';
import {
  type GatewayParsedCommand,
  type GatewayConfigParsedCommand,
  type GatewayServiceRunContext,
  type GatewayStartOverrides,
  type GatewayChannel,
} from './contracts.js';
import { normalizeGatewayChannels, resolveGatewayChannel } from './channelRegistry.js';
import { runGatewayServiceRunner } from './serviceRunner.js';
import { integrationRegistry } from './integrationRegistry.js';
import type { IntegrationRunContext, Integration } from '../../integrations/contracts.js';

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
    ...overrides
  } = parsed;

  if (action !== 'start') {
    throw new Error(`Unsupported gateway action: ${action}`);
  }

  const serviceContext: GatewayServiceRunContext = {
    channel,
    channels,
    action,
    daemon,
    statePath,
    logPath,
    serviceChild,
    debug,
    serviceArgv,
  };

  if (channels.length > 1) {
    await runGatewayServiceForChannels(overrides, serviceContext, channels);
    return 0;
  }

  const runtimeChannel = resolveGatewayChannel(channel);
  const runtime = integrationRegistry[runtimeChannel];

  await runIntegrationRuntime(runtime, runtimeChannel, overrides, {
    ...serviceContext,
    channel: runtimeChannel,
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
    await persistFeishuGatewayConfig(
      parsed.config as Partial<Record<string, unknown>> as Partial<Record<string, unknown>>,
      parsed.channel,
    );
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
            source: sources[key as keyof typeof sources],
          },
        ];
      }
      return [
        key,
        {
          value,
          source: sources[key as keyof typeof sources],
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
      const runtime = integrationRegistry[channel];
      if (runtime.preflight) {
        await runtime.preflight(overrides, { integration: channel } as IntegrationRunContext);
      }
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

  await Promise.all(
    normalizedChannels.map((channel) => {
      const runtime = integrationRegistry[channel];
      return runIntegrationRuntime(
        runtime,
        channel,
        overrides,
        {
          ...serviceContext,
          channel,
        },
      );
    }),
  );
}

export async function printGatewayServiceStatus(
  paths: { statePath: string; logPath: string },
  channel = 'gateway',
): Promise<void> {
  return resolveGatewayServiceStatus(paths, channel);
}

async function runIntegrationRuntime(
  runtime: Integration,
  channel: GatewayChannel,
  overrides: GatewayStartOverrides,
  serviceContext: GatewayServiceRunContext,
): Promise<void> {
  const context: IntegrationRunContext = { integration: channel };
  const shouldPreflightInProcess = !serviceContext.daemon || serviceContext.serviceChild === true;

  const runInProcess = async (): Promise<void> => {
    const preflightResult = shouldPreflightInProcess
      ? await runtime.preflight?.(overrides, context)
      : undefined;

    let sidecarStop: (() => Promise<void> | void) | undefined;
    if (runtime.startSidecars) {
      const sidecarHandle = await runtime.startSidecars(overrides, context, preflightResult);
      if (sidecarHandle) {
        sidecarStop = sidecarHandle.stop;
      }
    }

    try {
      await runtime.run(
        async () => Promise.resolve(undefined),
        overrides,
        context,
      );
    } finally {
      if (sidecarStop) {
        await sidecarStop();
      }
    }
  };

  await runGatewayServiceRunner({
    serviceContext,
    stateChannel: channel,
    stateChannels: [channel],
    runInProcess,
    preflight: async () => {
      if (serviceContext.daemon && runtime.preflight) {
        await runtime.preflight(overrides, context);
      }
    },
  });
}
