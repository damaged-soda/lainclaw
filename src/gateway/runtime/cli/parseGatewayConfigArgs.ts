import { parseArgv, type ArgOptionDefinition } from '../../../cli/shared/argParser.js';
import type { GatewayConfigParsedCommand } from '../contracts.js';
import { parseFeishuGatewayConfigFromOptions } from './parseGatewayArgs.js';

const GATEWAY_CONFIG_CHANNEL_OPTION: ArgOptionDefinition = {
  name: 'channel',
  type: 'string',
  parse: (raw) => {
    const value = raw.trim().toLowerCase();
    if (!value) {
      throw new Error('Invalid value for --channel');
    }
    return value;
  },
};

const GATEWAY_CONFIG_SHARED_OPTIONS: ArgOptionDefinition[] = [
  GATEWAY_CONFIG_CHANNEL_OPTION,
];

const GATEWAY_CONFIG_SET_OPTIONS: ArgOptionDefinition[] = [
  ...GATEWAY_CONFIG_SHARED_OPTIONS,
  { name: 'provider', type: 'string' },
  { name: 'profile', type: 'string' },
  { name: 'app-id', type: 'string' },
  { name: 'app-secret', type: 'string' },
  { name: 'with-tools', type: 'boolean', allowNegated: true, allowEquals: true },
  { name: 'tool-allow', type: 'string-list' },
  { name: 'memory', type: 'boolean', allowNegated: true, allowEquals: true },
  { name: 'heartbeat-enabled', type: 'boolean', allowNegated: true, allowEquals: true },
  { name: 'heartbeat-interval-ms', type: 'integer' },
  { name: 'heartbeat-target-open-id', type: 'string' },
  { name: 'heartbeat-session-key', type: 'string' },
  { name: 'pairing-policy', type: 'string' },
  { name: 'pairing-allow-from', type: 'string-list' },
  { name: 'pairing-pending-ttl-ms', type: 'integer' },
  { name: 'pairing-pending-max', type: 'integer' },
  { name: 'request-timeout-ms', type: 'integer' },
];

const GATEWAY_CONFIG_SHOW_CLEAR_OPTIONS: ArgOptionDefinition[] = [...GATEWAY_CONFIG_SHARED_OPTIONS];

const GATEWAY_CONFIG_MIGRATE_OPTIONS: ArgOptionDefinition[] = [
  GATEWAY_CONFIG_CHANNEL_OPTION,
  { name: 'dry-run', type: 'boolean', allowEquals: true },
];

function resolveConfigChannel(parsed: { channel?: unknown }): { channel: string; channelProvided: boolean } {
  const raw = parsed.channel;
  if (typeof raw === 'string') {
    const channel = raw.trim().toLowerCase();
    if (!channel) {
      throw new Error('Invalid value for --channel');
    }
    return {
      channel,
      channelProvided: true,
    };
  }

  return {
    channel: 'default',
    channelProvided: false,
  };
}

function parseGatewayConfigUnknownOptions(unknown: string[], prefix: string): never {
  throw new Error(`Unknown option for gateway config ${prefix}: ${unknown[0]}`);
}

function parseGatewayConfigPositional(positional: string[], prefix: string): never {
  throw new Error(`Unexpected argument for gateway config ${prefix}: ${positional[0]}`);
}

export function parseGatewayConfigArgs(argv: string[]): GatewayConfigParsedCommand {
  const subcommand = argv[0];
  if (!subcommand) {
    throw new Error('Missing gateway config subcommand');
  }

  if (subcommand === 'set') {
    const parsed = parseArgv(argv.slice(1), GATEWAY_CONFIG_SET_OPTIONS, { strictUnknown: true });
    if (parsed.unknownOptions.length > 0) {
      parseGatewayConfigUnknownOptions(parsed.unknownOptions, 'set');
    }
    if (parsed.positional.length > 0) {
      parseGatewayConfigPositional(parsed.positional, 'set');
    }

    const config = parseFeishuGatewayConfigFromOptions(parsed.options);
    if (Object.keys(config).length === 0) {
      throw new Error('No gateway config fields provided');
    }

    const { channel, channelProvided } = resolveConfigChannel(parsed.options);
    if ((channel === 'default' || !channelProvided)
      && (typeof config.appId === 'string' || typeof config.appSecret === 'string')) {
      throw new Error('appId/appSecret must be scoped with --channel, e.g. --channel feishu');
    }
    if (channel !== 'default' && typeof config.provider === 'string') {
      throw new Error('provider is a gateway-level field and cannot be set with --channel; set it at default scope');
    }

    return {
      channel,
      channelProvided,
      action: 'set',
      config,
    };
  }

  if (subcommand === 'show' || subcommand === 'clear') {
    const parsed = parseArgv(argv.slice(1), GATEWAY_CONFIG_SHOW_CLEAR_OPTIONS, { strictUnknown: true });
    if (parsed.unknownOptions.length > 0) {
      parseGatewayConfigUnknownOptions(parsed.unknownOptions, subcommand);
    }
    if (parsed.positional.length > 0) {
      parseGatewayConfigPositional(parsed.positional, subcommand);
    }

    const { channel, channelProvided } = resolveConfigChannel(parsed.options);
    return {
      channel,
      channelProvided,
      action: subcommand,
      config: {},
    };
  }

  if (subcommand === 'migrate') {
    const parsed = parseArgv(argv.slice(1), GATEWAY_CONFIG_MIGRATE_OPTIONS, { strictUnknown: true });
    if (parsed.unknownOptions.length > 0) {
      parseGatewayConfigUnknownOptions(parsed.unknownOptions, 'migrate');
    }
    if (parsed.positional.length > 0) {
      parseGatewayConfigPositional(parsed.positional, 'migrate');
    }
    if (parsed.options['dry-run'] !== true) {
      throw new Error('gateway config migrate currently only supports --dry-run');
    }

    const { channel, channelProvided } = resolveConfigChannel(parsed.options);
    return {
      channel,
      channelProvided,
      action: 'migrate',
      dryRun: true,
      config: {},
    };
  }

  throw new Error(`Unknown gateway config subcommand: ${subcommand}`);
}
