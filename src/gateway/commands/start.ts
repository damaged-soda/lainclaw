import {
  clearFeishuChannelConfig,
  loadFeishuChannelConfigWithSources,
  persistFeishuChannelConfig,
  type FeishuChannelConfig,
} from '../../channels/feishu/config.js';
import { maskConfigValue } from '../../channels/feishu/diagnostics.js';
import {
  clearGatewayRuntimeConfig,
  loadGatewayRuntimeConfigWithSources,
  persistGatewayRuntimeConfig,
} from '../../gateway/runtimeConfig.js';
import { getGatewayServiceSnapshot, resolveGatewayServiceStatus, stopGatewayService } from '../../gateway/serviceController.js';
import { resolveGatewayServicePaths } from '../../gateway/servicePaths.js';
import { resolveGatewayConfigPath } from '../configFile.js';
import {
  type GatewayParsedCommand,
  type GatewayConfigParsedCommand,
  type GatewayServiceRunContext,
  type GatewayStartOverrides,
  type GatewayChannel,
} from './contracts.js';
import { channelsRegistry, normalizeGatewayChannels, resolveGatewayChannel } from './channelRegistry.js';
import { runGatewayServiceRunner } from './serviceRunner.js';
import type { ChannelRunContext, Channel } from '../../channels/contracts.js';
import {
  resolveGatewayChannelBinding,
  type ResolvedGatewayChannelBinding,
} from '../channelBindings.js';
import { clearOutboundChannels, registerOutboundChannel } from '../../tools/outboundRegistry.js';
import { startHeartbeatRunner } from '../heartbeatRunner.js';

function formatDisplaySection(
  values: Record<string, unknown>,
  sources: Record<string, unknown>,
  options?: {
    maskedKeys?: string[];
  },
): Record<string, { value: unknown; source: unknown }> {
  const maskedKeys = new Set(options?.maskedKeys ?? []);
  const output: Record<string, { value: unknown; source: unknown }> = {};

  for (const [key, value] of Object.entries(values)) {
    output[key] = {
      value: typeof value === 'string' && maskedKeys.has(key) ? maskConfigValue(value) : value,
      source: sources[key],
    };
  }

  return output;
}

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
    config,
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
    await runGatewayServiceForChannels(config ?? {}, serviceContext, channels);
    return 0;
  }

  const runtimeChannel = resolveGatewayChannel(channel);
  const runtime = channelsRegistry[runtimeChannel];

  await runChannelRuntime(runtime, runtimeChannel, config, {
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

    const channelConfig = parsed.config.channelConfig as Partial<FeishuChannelConfig> | undefined;
    const runtimeConfig = parsed.config.runtimeConfig;

    if (channelConfig && Object.keys(channelConfig).length > 0) {
      await persistFeishuChannelConfig(channelConfig, parsed.channel);
    }
    if (runtimeConfig && Object.keys(runtimeConfig).length > 0) {
      await persistGatewayRuntimeConfig(runtimeConfig);
    }

    console.log('gateway config updated');
    return 0;
  }

  if (parsed.action === 'clear') {
    if (parsed.channelProvided && parsed.channel !== 'default') {
      await clearFeishuChannelConfig(parsed.channel);
    } else {
      await clearGatewayRuntimeConfig();
    }
    console.log('gateway config cleared');
    return 0;
  }

  const { runtimeConfig, sources: runtimeSources } = await loadGatewayRuntimeConfigWithSources();
  const { channelConfig, sources: channelSources } =
    parsed.channelProvided && parsed.channel !== 'default'
      ? await loadFeishuChannelConfigWithSources(parsed.channel)
      : { channelConfig: {}, sources: {} };

  console.log(JSON.stringify({
    channel: parsed.channel,
    configPath: resolveGatewayConfigPath(),
    channelConfig: formatDisplaySection(
      channelConfig as Record<string, unknown>,
      channelSources as Record<string, unknown>,
      { maskedKeys: ['appId', 'appSecret'] },
    ),
    runtimeConfig: formatDisplaySection(
      runtimeConfig as Record<string, unknown>,
      runtimeSources as Record<string, unknown>,
    ),
  }, null, 2));
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

  const resolvedChannels = await Promise.all(
    normalizedChannels.map((channel) => resolveGatewayRuntimeChannel(channel, overrides, serviceContext)),
  );

  if (serviceContext.daemon) {
    for (const resolved of resolvedChannels) {
      if (resolved.runtime.preflight) {
        await resolved.runtime.preflight({
          config: resolved.binding.channelConfig,
          context: resolved.context,
        });
      }
    }

    await runGatewayServiceRunner({
      serviceContext: {
        ...serviceContext,
        channel: 'gateway',
      },
      stateChannel: 'gateway',
      stateChannels: normalizedChannels,
      runInProcess: async () => runGatewayRuntimesWithHeartbeat(resolvedChannels, serviceContext),
    });
    return;
  }

  await runGatewayRuntimesWithHeartbeat(resolvedChannels, serviceContext);
}

export async function printGatewayServiceStatus(
  paths: { statePath: string; logPath: string },
  channel = 'gateway',
): Promise<void> {
  return resolveGatewayServiceStatus(paths, channel);
}

async function runChannelRuntime(
  runtime: Channel,
  channel: GatewayChannel,
  overrides: GatewayStartOverrides | undefined,
  serviceContext: GatewayServiceRunContext,
): Promise<void> {
  const resolved = await resolveGatewayRuntimeChannel(channel, overrides, serviceContext, runtime);

  const runInProcess = async (): Promise<void> => {
    await runGatewayRuntimesWithHeartbeat([resolved], serviceContext);
  };

  await runGatewayServiceRunner({
    serviceContext,
    stateChannel: channel,
    stateChannels: [channel],
    runInProcess,
    preflight: async () => {
      if (serviceContext.daemon && resolved.runtime.preflight) {
        await resolved.runtime.preflight({
          config: resolved.binding.channelConfig,
          context: resolved.context,
        });
      }
    },
  });
}

interface ResolvedGatewayRuntimeChannel {
  channel: GatewayChannel;
  runtime: Channel;
  binding: ResolvedGatewayChannelBinding;
  context: ChannelRunContext;
}

async function resolveGatewayRuntimeChannel(
  channel: GatewayChannel,
  overrides: GatewayStartOverrides | undefined,
  serviceContext: GatewayServiceRunContext,
  runtime = channelsRegistry[channel],
): Promise<ResolvedGatewayRuntimeChannel> {
  const context: ChannelRunContext = {
    channel,
    ...(serviceContext.debug === true ? { debug: true } : {}),
  };
  const binding = await resolveGatewayChannelBinding(channel, runtime, overrides, context);
  return {
    channel,
    runtime,
    binding,
    context,
  };
}

function registerGatewayOutbounds(channels: ResolvedGatewayRuntimeChannel[]): void {
  clearOutboundChannels();
  for (const resolved of channels) {
    if (!resolved.binding.outbound) {
      continue;
    }
    registerOutboundChannel(resolved.channel, resolved.binding.outbound);
  }
}

async function runGatewayRuntimesWithHeartbeat(
  channels: ResolvedGatewayRuntimeChannel[],
  serviceContext: GatewayServiceRunContext,
): Promise<void> {
  if (channels.length === 0) {
    return;
  }

  const shouldPreflightInProcess = !serviceContext.daemon;
  registerGatewayOutbounds(channels);
  const heartbeat = startHeartbeatRunner({
    cwd: process.cwd(),
    runtime: {
      ...channels[0].binding.runtimeConfig,
      ...(serviceContext.debug === true ? { debug: true } : {}),
    },
  });

  try {
    await Promise.all(
      channels.map(async (resolved) => {
        if (shouldPreflightInProcess) {
          await resolved.runtime.preflight?.({
            config: resolved.binding.channelConfig,
            context: resolved.context,
          });
        }

        await resolved.runtime.run({
          config: resolved.binding.channelConfig,
          context: resolved.context,
          onInbound: resolved.binding.inboundHandler,
        });
      }),
    );
  } finally {
    heartbeat.stop();
    clearOutboundChannels();
  }
}
