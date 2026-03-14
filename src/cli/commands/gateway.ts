import { Command, Option } from 'commander';
import {
  parsePositiveInt,
  addModelOptions,
} from '../shared/options.js';
import { setExitCode } from '../shared/exitCode.js';
import { normalizeGatewayChannels, resolveGatewayChannel } from '../../gateway/commands/channelRegistry.js';
import type {
  GatewayChannel,
  GatewayConfigParsedCommand,
  GatewayParsedCommand,
  GatewayStartOverrides,
} from '../../gateway/commands/contracts.js';
import {
  runGatewayConfigCommand,
  runGatewayStart,
  runGatewayStatusOrStop,
} from '../../gateway/commands/start.js';
import type { FeishuChannelConfig } from '../../channels/feishu/config.js';
import type { GatewayRuntimeConfig } from '../../gateway/runtimeConfig.js';

type GatewayCommonOptions = {
  channel?: string[];
  pidFile?: string;
  logFile?: string;
  serviceChild?: boolean;
  provider?: string;
  profile?: string;
  withTools?: boolean;
  memory?: boolean;
  pairingPolicy?: string;
  pairingAllowFrom?: string[];
  pairingPendingTtlMs?: string;
  pairingPendingMax?: string;
  appId?: string;
  appSecret?: string;
  requestTimeoutMs?: string;
};

type GatewayStartOptions = GatewayCommonOptions & {
  debug?: boolean;
  daemon?: boolean;
};

type GatewayConfigOptions = {
  channel?: string;
  provider?: string;
  profile?: string;
  appId?: string;
  appSecret?: string;
  withTools?: boolean;
  memory?: boolean;
  pairingPolicy?: string;
  pairingAllowFrom?: string[];
  pairingPendingTtlMs?: string;
  pairingPendingMax?: string;
  requestTimeoutMs?: string;
};

type GatewayStatusStopOptions = {
  channel?: string[];
  pidFile?: string;
  logFile?: string;
  serviceChild?: boolean;
};

const FEISHU_ONLY_OPTIONS: Array<[keyof GatewayCommonOptions & keyof GatewayConfigOptions, string]> = [
  ['appId', 'app-id'],
  ['appSecret', 'app-secret'],
  ['pairingPolicy', 'pairing-policy'],
  ['pairingAllowFrom', 'pairing-allow-from'],
  ['pairingPendingTtlMs', 'pairing-pending-ttl-ms'],
  ['pairingPendingMax', 'pairing-pending-max'],
  ['requestTimeoutMs', 'request-timeout-ms'],
];

function normalizeText(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }
  return value;
}

function parseOptionalString(raw: string | undefined): string | undefined {
  if (typeof raw === 'string') {
    return raw;
  }
  return undefined;
}

function normalizePositiveIntValue(raw: string | undefined, label: string): number | undefined {
  if (!raw) {
    return undefined;
  }
  return parsePositiveInt(raw.trim(), `--${label}`);
}

function normalizePairingPolicy(raw: unknown): FeishuChannelConfig['pairingPolicy'] | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const normalized = normalizeText(raw)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized === 'open'
    || normalized === 'allowlist'
    || normalized === 'pairing'
    || normalized === 'disabled'
  ) {
    return normalized;
  }
  return undefined;
}

function parseGatewayRuntimeConfigFromOptions(
  options: GatewayCommonOptions | GatewayConfigOptions,
): GatewayRuntimeConfig {
  const provider = parseOptionalString(options.provider);
  const profile = parseOptionalString(options.profile);

  return {
    ...(provider ? { provider } : {}),
    ...(profile ? { profileId: profile } : {}),
    ...(typeof options.withTools === 'boolean' ? { withTools: options.withTools } : {}),
    ...(typeof options.memory === 'boolean' ? { memory: options.memory } : {}),
  };
}

function parseFeishuGatewayConfigFromOptions(
  options: GatewayCommonOptions | GatewayConfigOptions,
): GatewayStartOverrides {
  const pairingPendingTtlMs = normalizePositiveIntValue(normalizeText(options.pairingPendingTtlMs), 'pairing-pending-ttl-ms');
  const pairingPendingMax = normalizePositiveIntValue(normalizeText(options.pairingPendingMax), 'pairing-pending-max');
  const requestTimeoutMs = normalizePositiveIntValue(normalizeText(options.requestTimeoutMs), 'request-timeout-ms');

  const channelConfig = {
    ...(parseOptionalString(options.appId) !== undefined ? { appId: parseOptionalString(options.appId)! } : {}),
    ...(parseOptionalString(options.appSecret) !== undefined ? { appSecret: parseOptionalString(options.appSecret)! } : {}),
    ...(requestTimeoutMs ? { requestTimeoutMs } : {}),
    ...(normalizePairingPolicy(options.pairingPolicy)
      ? { pairingPolicy: normalizePairingPolicy(options.pairingPolicy) as FeishuChannelConfig['pairingPolicy'] }
      : {}),
    ...(Array.isArray(options.pairingAllowFrom) && options.pairingAllowFrom.length > 0 ? { pairingAllowFrom: options.pairingAllowFrom } : {}),
    ...(pairingPendingTtlMs ? { pairingPendingTtlMs } : {}),
    ...(pairingPendingMax ? { pairingPendingMax } : {}),
  };
  const runtimeConfig = parseGatewayRuntimeConfigFromOptions(options);

  return {
    ...(Object.keys(channelConfig).length > 0 ? { channelConfig } : {}),
    ...(Object.keys(runtimeConfig).length > 0 ? { runtimeConfig } : {}),
  };
}

function parseLocalGatewayConfigFromOptions(options: GatewayCommonOptions): GatewayStartOverrides {
  for (const [key, optionName] of FEISHU_ONLY_OPTIONS) {
    const raw = options[key];
    if (raw === undefined) {
      continue;
    }
    if (Array.isArray(raw) ? raw.length > 0 : true) {
      throw new Error(`Unknown option: --${optionName}`);
    }
  }

  const runtimeConfig = parseGatewayRuntimeConfigFromOptions(options);

  return Object.keys(runtimeConfig).length > 0 ? { runtimeConfig } : {};
}

function resolveGatewayChannels(
  rawChannels: string[] | undefined,
): { channels: GatewayChannel[]; channelProvided: boolean } {
  if (!rawChannels || rawChannels.length === 0) {
    return {
      channels: ['feishu'],
      channelProvided: false,
    };
  }
  return {
    channels: normalizeGatewayChannels(rawChannels.map((rawChannel) => resolveGatewayChannel(rawChannel))),
    channelProvided: true,
  };
}

function extractGatewayServiceArgv(command: Command): string[] {
  const rawArgs = ((command as { rawArgs?: string[] }).rawArgs ?? []);
  const commandName = command.name();
  const commandIndex = rawArgs.indexOf(commandName);
  if (commandIndex < 0) {
    return [];
  }

  const parent = command.parent;
  if (!parent) {
    return rawArgs.slice(commandIndex + 1);
  }

  const parentName = parent.name();
  const parentIndex = rawArgs.indexOf(parentName);
  if (parentIndex < 0 || parentIndex >= commandIndex) {
    return rawArgs.slice(commandIndex + 1);
  }

  return [...rawArgs.slice(parentIndex + 1, commandIndex), ...rawArgs.slice(commandIndex + 1)];
}

function buildGatewayStartParsedCommand(
  command: Command,
  options: GatewayStartOptions,
  action: GatewayParsedCommand['action'],
): GatewayParsedCommand {
  const { channels } = resolveGatewayChannels(options.channel);
  const merged = options;
  const channel = channels[0] ?? 'feishu';
  const common = {
    channel,
    channels,
    action,
    statePath: normalizeText(merged.pidFile),
    logPath: normalizeText(merged.logFile),
    serviceChild: merged.serviceChild === true,
    debug: action === 'start' ? merged.debug === true : false,
    serviceArgv: extractGatewayServiceArgv(command),
    ...(action === 'start' && merged.daemon === true ? { daemon: true } : {}),
  };

  if (action !== 'start') {
    return {
      ...common,
      action,
    };
  }

  const isSingleFeishu = channels.length === 1 && channels[0] === 'feishu';
  const config = isSingleFeishu
    ? parseFeishuGatewayConfigFromOptions(merged)
    : parseLocalGatewayConfigFromOptions(merged);

  return {
    ...common,
    config,
    action,
  };
}

function buildGatewayStatusStopParsedCommand(
  command: Command,
  options: GatewayStatusStopOptions,
  action: 'status' | 'stop',
): GatewayParsedCommand {
  const { channels } = resolveGatewayChannels(options.channel);
  const merged = options;
  const channel = channels[0] ?? 'feishu';
  return {
    channel,
    channels,
    action,
    statePath: normalizeText(merged.pidFile),
    logPath: normalizeText(merged.logFile),
    serviceChild: merged.serviceChild === true,
    serviceArgv: extractGatewayServiceArgv(command),
  };
}

function resolveGatewayConfigChannel(channelInput: string | undefined): { channel: string; channelProvided: boolean } {
  if (typeof channelInput !== 'string') {
    return { channel: 'default', channelProvided: false };
  }
  const channel = channelInput.trim().toLowerCase();
  if (!channel) {
    throw new Error('Invalid value for --channel');
  }
  if (channel === 'default') {
    return {
      channel,
      channelProvided: true,
    };
  }
  return {
    channel: resolveGatewayChannel(channel),
    channelProvided: true,
  };
}

function buildGatewayConfigParsedCommand(
  command: 'set' | 'show' | 'clear',
  options: GatewayConfigOptions,
): GatewayConfigParsedCommand {
  const { channel, channelProvided } = resolveGatewayConfigChannel(options.channel);

  if (command === 'set') {
    const config = parseFeishuGatewayConfigFromOptions(options);
    if (Object.keys(config.channelConfig ?? {}).length === 0 && Object.keys(config.runtimeConfig ?? {}).length === 0) {
      throw new Error('No gateway config fields provided');
    }
    if (!channelProvided && Object.keys(config.channelConfig ?? {}).length > 0) {
      throw new Error('channelConfig fields require --channel, e.g. --channel feishu');
    }
    if (channelProvided && Object.keys(config.runtimeConfig ?? {}).length > 0) {
      throw new Error('runtimeConfig is gateway-level and cannot be set with --channel');
    }
    if (channelProvided && channel !== 'feishu' && Object.keys(config.channelConfig ?? {}).length > 0) {
      throw new Error(`channel ${channel} does not support persisted channelConfig`);
    }
    return {
      channel,
      channelProvided,
      action: command,
      config,
    };
  }

  if (command === 'show' || command === 'clear') {
    return {
      channel,
      channelProvided,
      action: command,
      config: {},
    };
  }

  throw new Error(`Unsupported gateway config action: ${command}`);
}

function addModelRuntimeOptions(command: Command, includeMemory: boolean): void {
  addModelOptions(command, {
    includeMemory,
    providerDescription: 'Model provider override.',
    profileDescription: 'Model profile override.',
    withToolsDescription: 'Enable/disable tool calls.',
    noWithToolsDescription: 'Disable tool calls.',
    ...(includeMemory
      ? {
        memoryDescription: includeMemory ? 'Enable/disable memory persistence.' : undefined,
        noMemoryDescription: 'Disable memory persistence.',
      }
      : {}),
  });
}

function buildGatewayStartOptions(command: Command): void {
  command
    .addOption(new Option('--channel <channel...>', 'Select gateway runtime channel.'))
    .addOption(new Option('--pid-file <path>', 'Gateway service state file path.'))
    .addOption(new Option('--log-file <path>', 'Gateway service log file path.'))
    .addOption(new Option('--service-child', 'Run gateway process as child service.'))
    .addOption(new Option('--debug', 'Enable local debug output.'))
    .addOption(new Option('--daemon', 'Run gateway service in daemon mode.'))
    .addOption(new Option('--pairing-policy <open|allowlist|pairing|disabled>', 'Pairing policy.'))
    .addOption(new Option('--pairing-allow-from <ids>', 'Pairing allowlist.'))
    .addOption(new Option('--pairing-pending-ttl-ms <ms>', 'Pairing pending TTL in ms.'))
    .addOption(new Option('--pairing-pending-max <n>', 'Pairing pending max count.'))
    .addOption(new Option('--app-id <id>', 'Feishu app id.'))
    .addOption(new Option('--app-secret <secret>', 'Feishu app secret.'))
    .addOption(new Option('--request-timeout-ms <ms>', 'Feishu API request timeout ms.'));
  addModelRuntimeOptions(command, true);
}

function buildGatewayConfigOptions(command: Command): void {
  command
    .addOption(new Option('--channel <channel>', 'Select gateway config channel.'))
    .addOption(new Option('--app-id <id>', 'Persist feishu app id.'))
    .addOption(new Option('--app-secret <secret>', 'Persist feishu app secret.'));
  addModelRuntimeOptions(command, true);
  command
    .addOption(new Option('--pairing-policy <open|allowlist|pairing|disabled>', 'Persist pairing policy.'))
    .addOption(new Option('--pairing-allow-from <ids>', 'Persist pairing allowlist.'))
    .addOption(new Option('--pairing-pending-ttl-ms <ms>', 'Persist pairing pending ttl.'))
    .addOption(new Option('--pairing-pending-max <n>', 'Persist pairing pending max.'))
    .addOption(new Option('--request-timeout-ms <ms>', 'Persist Feishu API request timeout ms.'));
}

function buildGatewayStatusStopOptions(command: Command): void {
  command
    .addOption(new Option('--channel <channel...>', 'Select gateway runtime channel.'))
    .addOption(new Option('--pid-file <path>', 'Gateway service state file path.'))
    .addOption(new Option('--log-file <path>', 'Gateway service log file path.'))
    .addOption(new Option('--service-child', 'Run gateway process as child service.'));
}

export function buildGatewayCommand(program: Command): Command {
  const gateway = program
    .command('gateway')
    .description('Manage gateway runtime.')
    .addHelpText(
      'after',
      [
        'Usage:',
        '  lainclaw gateway [start|status|stop] [options]',
        '  lainclaw gateway config <set|show|clear> [options]',
        '',
        'Examples:',
        '  lainclaw gateway',
        '  lainclaw gateway start --provider <provider> --profile <profile> --with-tools --memory',
        '  lainclaw gateway status --channel feishu',
        '  lainclaw gateway stop --channel local',
        '  lainclaw gateway config set --channel feishu --app-id <AppID> --app-secret <AppSecret>',
      ].join('\n'),
    )
    .addHelpText('after', 'Notes:')
    .addHelpText('after', [
      '  --channel supports feishu and local',
    ].join('\n'));

  gateway.action((_options: never, command: Command) => {
    command.outputHelp();
    setExitCode(command, 0);
  });

  const start = gateway.command('start').description('Start gateway service.');
  buildGatewayStartOptions(start);
  start
    .addHelpText(
      'after',
      [
        'Examples:',
        '  lainclaw gateway start --channel local --provider <provider> --profile <profile>',
        '  lainclaw gateway start --provider <provider> --with-tools --memory',
      ].join('\n'),
    )
    .action(async (options: GatewayStartOptions, command: Command) => {
      setExitCode(
        command,
        await runGatewayStart(buildGatewayStartParsedCommand(command, options, 'start')),
      );
    });

  const status = gateway.command('status').description('Show gateway service status.');
  buildGatewayStatusStopOptions(status);
  status
    .addHelpText(
      'after',
      [
        'Examples:',
        '  lainclaw gateway status --channel feishu',
        '  lainclaw gateway status --pid-file ./service.json',
      ].join('\n'),
    )
    .action(async (options: GatewayStatusStopOptions, command: Command) => {
      setExitCode(
        command,
        await runGatewayStatusOrStop(
          buildGatewayStatusStopParsedCommand(command, options, 'status'),
          'status',
        ),
      );
    });

  const stop = gateway.command('stop').description('Stop gateway service.');
  buildGatewayStatusStopOptions(stop);
  stop
    .addHelpText(
      'after',
      [
        'Examples:',
        '  lainclaw gateway stop --channel feishu',
        '  lainclaw gateway stop --log-file ./service.log',
      ].join('\n'),
    )
    .action(async (options: GatewayStatusStopOptions, command: Command) => {
      setExitCode(
        command,
        await runGatewayStatusOrStop(
          buildGatewayStatusStopParsedCommand(command, options, 'stop'),
          'stop',
        ),
      );
    });

  const config = gateway.command('config').description('Manage gateway config.');
  const set = config.command('set').description('Set gateway config fields.');
  buildGatewayConfigOptions(set);
  set
    .addHelpText(
      'after',
      ['Examples:', '  lainclaw gateway config set --app-id <appId> --app-secret <appSecret>'].join('\n'),
    )
    .action(async (options: GatewayConfigOptions, command: Command) => {
      const parsedOptions = { ...(command.opts<GatewayConfigOptions>()), ...options };
      setExitCode(command, await runGatewayConfigCommand(buildGatewayConfigParsedCommand('set', parsedOptions)));
    });

  const show = config.command('show').description('Show gateway config.');
  show.addOption(new Option('--channel <channel>', 'Select gateway config channel.'));
  show.action(async (options: GatewayConfigOptions, command: Command) => {
    const parsedOptions = { ...(command.opts<GatewayConfigOptions>()), ...options };
    setExitCode(command, await runGatewayConfigCommand(buildGatewayConfigParsedCommand('show', parsedOptions)));
  });

  const clear = config.command('clear').description('Clear gateway config.');
  clear.addOption(new Option('--channel <channel>', 'Select gateway config channel.'));
  clear.addHelpText('after', ['Examples:', '  lainclaw gateway config clear --channel feishu'].join('\n'));
  clear.action(async (options: GatewayConfigOptions, command: Command) => {
    const parsedOptions = { ...(command.opts<GatewayConfigOptions>()), ...options };
    setExitCode(command, await runGatewayConfigCommand(buildGatewayConfigParsedCommand('clear', parsedOptions)));
  });
  return gateway;
}
