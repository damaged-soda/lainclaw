import { parseArgv, type ArgOptionDefinition } from '../../../cli/shared/argParser.js';
import { parsePositiveIntValue } from '../../../cli/shared/args.js';
import { normalizeGatewayChannels, resolveGatewayChannel } from '../channelRegistry.js';
import type {
  GatewayParsedCommand,
  GatewayStartOverrides,
} from '../contracts.js';
import type { FeishuGatewayConfig } from '../../../channels/feishu/config.js';
import type { LocalGatewayOverrides } from '../../../channels/local/server.js';

type ParsedGatewayAction = 'start' | 'status' | 'stop';

type ParsedOptionMap = Record<string, unknown>;

const GATEWAY_ACTIONS = new Set<ParsedGatewayAction>(['start', 'status', 'stop']);
const FEISHU_ONLY_OPTION_KEYS = new Set<string>([
  'app-id',
  'app-secret',
  'heartbeat-enabled',
  'heartbeat-interval-ms',
  'heartbeat-target-open-id',
  'heartbeat-session-key',
  'pairing-policy',
  'pairing-allow-from',
  'pairing-pending-ttl-ms',
  'pairing-pending-max',
  'request-timeout-ms',
]);

const GATEWAY_COMMON_OPTIONS: ArgOptionDefinition[] = [
  {
    name: 'channel',
    type: 'string',
    multiple: true,
    parse: (raw) => resolveGatewayChannel(raw),
  },
  { name: 'pid-file', type: 'string' },
  { name: 'log-file', type: 'string' },
  { name: 'service-child', type: 'boolean', allowEquals: true },
];

const GATEWAY_MODEL_OPTIONS: ArgOptionDefinition[] = [
  { name: 'provider', type: 'string' },
  { name: 'profile', type: 'string' },
  {
    name: 'with-tools',
    type: 'boolean',
    allowNegated: true,
    allowEquals: true,
  },
  { name: 'tool-allow', type: 'string-list' },
  {
    name: 'memory',
    type: 'boolean',
    allowNegated: true,
    allowEquals: true,
  },
];

const GATEWAY_RUNTIME_OPTIONS: ArgOptionDefinition[] = [
  {
    name: 'heartbeat-enabled',
    type: 'boolean',
    allowNegated: true,
    allowEquals: true,
  },
  {
    name: 'heartbeat-interval-ms',
    type: 'integer',
    parse: (raw, index) => parsePositiveIntValue(raw, index + 1, '--heartbeat-interval-ms'),
  },
  { name: 'heartbeat-target-open-id', type: 'string' },
  { name: 'heartbeat-session-key', type: 'string' },
  { name: 'pairing-policy', type: 'string' },
  { name: 'pairing-allow-from', type: 'string-list' },
  {
    name: 'pairing-pending-ttl-ms',
    type: 'integer',
    parse: (raw, index) => parsePositiveIntValue(raw, index + 1, '--pairing-pending-ttl-ms'),
  },
  {
    name: 'pairing-pending-max',
    type: 'integer',
    parse: (raw, index) => parsePositiveIntValue(raw, index + 1, '--pairing-pending-max'),
  },
];

const GATEWAY_COMMON_CONFIG_OPTIONS: ArgOptionDefinition[] = [
  { name: 'app-id', type: 'string' },
  {
    name: 'app-secret',
    type: 'string',
  },
  {
    name: 'request-timeout-ms',
    type: 'integer',
    parse: (raw, index) => parsePositiveIntValue(raw, index + 1, '--request-timeout-ms'),
  },
];

const GATEWAY_START_OPTIONS: ArgOptionDefinition[] = [
  ...GATEWAY_COMMON_OPTIONS,
  ...GATEWAY_MODEL_OPTIONS,
  ...GATEWAY_RUNTIME_OPTIONS,
  ...GATEWAY_COMMON_CONFIG_OPTIONS,
  { name: 'debug', type: 'boolean', allowEquals: true },
  { name: 'daemon', type: 'boolean', allowEquals: true },
];

const GATEWAY_STATUS_OPTIONS: ArgOptionDefinition[] = [...GATEWAY_COMMON_OPTIONS];

const GATEWAY_LOCAL_OPTIONS: ArgOptionDefinition[] = [
  ...GATEWAY_MODEL_OPTIONS,
];

function normalizePairingPolicy(raw: unknown): FeishuGatewayConfig['pairingPolicy'] | undefined {
  const normalized = (raw as string)?.trim().toLowerCase();
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

function resolveOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

function resolveOptionalStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const list = value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
  return list.length > 0 ? list : undefined;
}

function resolveOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

function resolveOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return undefined;
}

export function parseFeishuGatewayConfigFromOptions(
  parsedOptions: ParsedOptionMap,
): Partial<FeishuGatewayConfig> {
  return {
    ...(resolveOptionalString(parsedOptions.provider) ? { provider: resolveOptionalString(parsedOptions.provider)! } : {}),
    ...(resolveOptionalString(parsedOptions.profile) ? { profileId: resolveOptionalString(parsedOptions.profile)! } : {}),
    ...(typeof resolveOptionalBoolean(parsedOptions['with-tools']) === 'boolean' ? { withTools: parsedOptions['with-tools'] as boolean } : {}),
    ...(typeof resolveOptionalBoolean(parsedOptions.memory) === 'boolean' ? { memory: parsedOptions.memory as boolean } : {}),
    ...(resolveOptionalStringList(parsedOptions['tool-allow']) ? { toolAllow: resolveOptionalStringList(parsedOptions['tool-allow'])! } : {}),
    ...(resolveOptionalString(parsedOptions['app-id']) ? { appId: resolveOptionalString(parsedOptions['app-id'])! } : {}),
    ...(resolveOptionalString(parsedOptions['app-secret']) ? { appSecret: resolveOptionalString(parsedOptions['app-secret'])! } : {}),
    ...(resolveOptionalNumber(parsedOptions['request-timeout-ms'])
      ? { requestTimeoutMs: resolveOptionalNumber(parsedOptions['request-timeout-ms'])! }
      : {}),
    ...(typeof resolveOptionalBoolean(parsedOptions['heartbeat-enabled']) === 'boolean'
      ? { heartbeatEnabled: resolveOptionalBoolean(parsedOptions['heartbeat-enabled'])! }
      : {}),
    ...(resolveOptionalNumber(parsedOptions['heartbeat-interval-ms'])
      ? { heartbeatIntervalMs: resolveOptionalNumber(parsedOptions['heartbeat-interval-ms'])! }
      : {}),
    ...(resolveOptionalString(parsedOptions['heartbeat-target-open-id'])
      ? { heartbeatTargetOpenId: resolveOptionalString(parsedOptions['heartbeat-target-open-id'])! }
      : {}),
    ...(resolveOptionalString(parsedOptions['heartbeat-session-key'])
      ? { heartbeatSessionKey: resolveOptionalString(parsedOptions['heartbeat-session-key'])! }
      : {}),
    ...(typeof normalizePairingPolicy(parsedOptions['pairing-policy']) !== 'undefined'
      ? { pairingPolicy: normalizePairingPolicy(parsedOptions['pairing-policy'])! }
      : {}),
    ...(resolveOptionalStringList(parsedOptions['pairing-allow-from'])
      ? { pairingAllowFrom: resolveOptionalStringList(parsedOptions['pairing-allow-from'])! }
      : {}),
    ...(resolveOptionalNumber(parsedOptions['pairing-pending-ttl-ms'])
      ? { pairingPendingTtlMs: resolveOptionalNumber(parsedOptions['pairing-pending-ttl-ms'])! }
      : {}),
    ...(resolveOptionalNumber(parsedOptions['pairing-pending-max'])
      ? { pairingPendingMax: resolveOptionalNumber(parsedOptions['pairing-pending-max'])! }
      : {}),
  };
}

function parseLocalGatewayConfigFromOptions(parsedOptions: ParsedOptionMap): GatewayStartOverrides {
  for (const unsupportedKey of FEISHU_ONLY_OPTION_KEYS) {
    const raw = parsedOptions[unsupportedKey];
    if (raw === undefined) {
      continue;
    }
    if (Array.isArray(raw) ? raw.length > 0 : raw !== undefined) {
      throw new Error(`Unknown option: --${unsupportedKey}`);
    }
  }

  return {
    ...(resolveOptionalString(parsedOptions.provider) ? { provider: resolveOptionalString(parsedOptions.provider)! } : {}),
    ...(resolveOptionalString(parsedOptions.profile) ? { profileId: resolveOptionalString(parsedOptions.profile)! } : {}),
    ...(typeof resolveOptionalBoolean(parsedOptions['with-tools']) === 'boolean' ? { withTools: parsedOptions['with-tools'] as boolean } : {}),
    ...(typeof resolveOptionalBoolean(parsedOptions.memory) === 'boolean' ? { memory: parsedOptions.memory as boolean } : {}),
    ...(resolveOptionalStringList(parsedOptions['tool-allow']) ? { toolAllow: resolveOptionalStringList(parsedOptions['tool-allow'])! } : {}),
  } as GatewayStartOverrides;
}

function parseGatewayChannels(parsedOptions: ParsedOptionMap): { channels: Array<'feishu' | 'local'>; hasChannel: boolean } {
  const rawChannels = parsedOptions.channel;
  if (typeof rawChannels === 'string') {
    return {
      channels: normalizeGatewayChannels([rawChannels as 'feishu' | 'local']),
      hasChannel: true,
    };
  }

  if (Array.isArray(rawChannels)) {
    const channels = rawChannels
      .filter((value): value is 'feishu' | 'local' => value === 'feishu' || value === 'local')
      .map((value) => resolveGatewayChannel(value as string));
    return {
      channels: normalizeGatewayChannels(channels),
      hasChannel: channels.length > 0,
    };
  }

  return {
    channels: ['feishu'],
    hasChannel: false,
  };
}

export function parseGatewayArgs(argv: string[]): GatewayParsedCommand {
  const [actionInput, ...restArgv] = argv;
  let action: ParsedGatewayAction = 'start';
  let rawArgv = argv;

  if (actionInput && !actionInput.startsWith('--')) {
    if (actionInput !== 'start' && actionInput !== 'status' && actionInput !== 'stop') {
      throw new Error(`Unknown gateway subcommand: ${actionInput}`);
    }
    action = actionInput;
    rawArgv = restArgv;
  }

  const optionsSpec = action === 'start' ? GATEWAY_START_OPTIONS : GATEWAY_STATUS_OPTIONS;
  const parsed = parseArgv(rawArgv, optionsSpec, { strictUnknown: true });

  if (parsed.unknownOptions.length > 0) {
    throw new Error(`Unknown option for gateway ${action}: ${parsed.unknownOptions[0]}`);
  }
  if (parsed.positional.length > 0) {
    throw new Error(`Unknown argument for gateway ${action}: ${parsed.positional[0]}`);
  }

  const { channels } = parseGatewayChannels(parsed.options);
  const channel = channels[0] ?? 'feishu';
  const base: GatewayParsedCommand = {
    action,
    channel,
    channels,
    daemon: parsed.options.daemon === true,
    statePath: resolveOptionalString(parsed.options['pid-file']) || undefined,
    logPath: resolveOptionalString(parsed.options['log-file']) || undefined,
    serviceChild: parsed.options['service-child'] === true,
    debug: action === 'start' ? parsed.options.debug === true : false,
    serviceArgv: rawArgv,
    ...(rawArgv.length > 0 ? { } : {}),
  };

  if (action !== 'start') {
    return base;
  }

  const isSingleFeishu = channels.length === 1 && channels[0] === 'feishu';
  const config = isSingleFeishu
    ? parseFeishuGatewayConfigFromOptions(parsed.options)
    : parseLocalGatewayConfigFromOptions(parsed.options);

  return {
    ...base,
    ...config,
    action,
  };
}
