import {
  parseBooleanFlag,
  parseCsvOption,
  parsePositiveIntValue,
  throwIfMissingValue,
  parseModelCommandArgs,
  type ParsedModelCommandArgs,
} from '../shared/args.js';
import type { FeishuGatewayConfig } from '../../channels/feishu/config.js';
import type { LocalGatewayOverrides } from '../../channels/local/server.js';

type GatewayChannel = 'feishu' | 'local';
type GatewayStartOverrides = Partial<FeishuGatewayConfig> & Partial<LocalGatewayOverrides>;

interface GatewayChannelPlugin {
  name: GatewayChannel;
  parseStartArgs: (argv: string[]) => GatewayStartOverrides;
}

function normalizePairingPolicy(raw: string | undefined): FeishuGatewayConfig['pairingPolicy'] {
  const normalized = raw?.trim().toLowerCase();
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

export function parseFeishuServerArgs(argv: string[]): {
  appId?: string;
  appSecret?: string;
  requestTimeoutMs?: number;
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  memory?: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
  heartbeatEnabled?: boolean;
  heartbeatIntervalMs?: number;
  heartbeatTargetOpenId?: string;
  heartbeatSessionKey?: string;
  pairingPolicy?: FeishuGatewayConfig['pairingPolicy'];
  pairingPendingTtlMs?: number;
  pairingPendingMax?: number;
  pairingAllowFrom?: string[];
} {
  let appId: string | undefined;
  let appSecret: string | undefined;
  let requestTimeoutMs: number | undefined;
  let provider: string | undefined;
  let profileId: string | undefined;
  let withTools: boolean | undefined;
  let memory: boolean | undefined;
  let toolAllow: string[] | undefined;
  let toolMaxSteps: number | undefined;
  let heartbeatEnabled: boolean | undefined;
  let heartbeatIntervalMs: number | undefined;
  let heartbeatTargetOpenId: string | undefined;
  let heartbeatSessionKey: string | undefined;
  let pairingPolicy: string | undefined;
  let pairingPendingTtlMs: number | undefined;
  let pairingPendingMax: number | undefined;
  let pairingAllowFrom: string[] | undefined;
  const modelArgv: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--app-id') {
      throwIfMissingValue('app-id', i + 1, argv);
      appId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--app-id=')) {
      appId = arg.slice('--app-id='.length);
      continue;
    }
    if (arg === '--app-secret') {
      throwIfMissingValue('app-secret', i + 1, argv);
      appSecret = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--app-secret=')) {
      appSecret = arg.slice('--app-secret='.length);
      continue;
    }
    if (arg === '--request-timeout-ms') {
      throwIfMissingValue('request-timeout-ms', i + 1, argv);
      requestTimeoutMs = parsePositiveIntValue(argv[i + 1], i + 1, '--request-timeout-ms');
      i += 1;
      continue;
    }
    if (arg.startsWith('--request-timeout-ms=')) {
      requestTimeoutMs = parsePositiveIntValue(arg.slice('--request-timeout-ms='.length), i + 1, '--request-timeout-ms');
      continue;
    }

    if (arg === '--pairing-policy') {
      throwIfMissingValue('pairing-policy', i + 1, argv);
      pairingPolicy = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--pairing-policy=')) {
      pairingPolicy = arg.slice('--pairing-policy='.length);
      continue;
    }

    if (arg === '--pairing-pending-ttl-ms') {
      throwIfMissingValue('pairing-pending-ttl-ms', i + 1, argv);
      pairingPendingTtlMs = parsePositiveIntValue(argv[i + 1], i + 1, '--pairing-pending-ttl-ms');
      i += 1;
      continue;
    }
    if (arg.startsWith('--pairing-pending-ttl-ms=')) {
      pairingPendingTtlMs = parsePositiveIntValue(
        arg.slice('--pairing-pending-ttl-ms='.length),
        i + 1,
        '--pairing-pending-ttl-ms',
      );
      continue;
    }

    if (arg === '--pairing-pending-max') {
      throwIfMissingValue('pairing-pending-max', i + 1, argv);
      pairingPendingMax = parsePositiveIntValue(argv[i + 1], i + 1, '--pairing-pending-max');
      i += 1;
      continue;
    }
    if (arg.startsWith('--pairing-pending-max=')) {
      pairingPendingMax = parsePositiveIntValue(
        arg.slice('--pairing-pending-max='.length),
        i + 1,
        '--pairing-pending-max',
      );
      continue;
    }

    if (arg === '--pairing-allow-from') {
      throwIfMissingValue('pairing-allow-from', i + 1, argv);
      pairingAllowFrom = parseCsvOption(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--pairing-allow-from=')) {
      pairingAllowFrom = parseCsvOption(arg.slice('--pairing-allow-from='.length));
      continue;
    }

    if (arg === '--heartbeat-enabled' || arg === '--no-heartbeat-enabled' || arg.startsWith('--heartbeat-enabled=')) {
      heartbeatEnabled = parseBooleanFlag(arg, i, 'heartbeat-enabled');
      continue;
    }

    if (arg === '--heartbeat-interval-ms') {
      throwIfMissingValue('heartbeat-interval-ms', i + 1, argv);
      heartbeatIntervalMs = parsePositiveIntValue(argv[i + 1], i + 1, '--heartbeat-interval-ms');
      i += 1;
      continue;
    }
    if (arg.startsWith('--heartbeat-interval-ms=')) {
      heartbeatIntervalMs = parsePositiveIntValue(
        arg.slice('--heartbeat-interval-ms='.length),
        i + 1,
        '--heartbeat-interval-ms',
      );
      continue;
    }

    if (arg === '--heartbeat-target-open-id') {
      throwIfMissingValue('heartbeat-target-open-id', i + 1, argv);
      heartbeatTargetOpenId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--heartbeat-target-open-id=')) {
      heartbeatTargetOpenId = arg.slice('--heartbeat-target-open-id='.length);
      continue;
    }

    if (arg === '--heartbeat-session-key') {
      throwIfMissingValue('heartbeat-session-key', i + 1, argv);
      heartbeatSessionKey = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--heartbeat-session-key=')) {
      heartbeatSessionKey = arg.slice('--heartbeat-session-key='.length);
      continue;
    }

    if (arg.startsWith('--')) {
      modelArgv.push(arg);
      if (!arg.includes('=') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        modelArgv.push(argv[i + 1]);
        i += 1;
      }
      continue;
    }
    modelArgv.push(arg);
  }

  const parsedModel: ParsedModelCommandArgs = parseModelCommandArgs(modelArgv, {
    allowMemory: true,
    strictUnknown: true,
  });

  if (parsedModel.positional.length > 0) {
    throw new Error(`Unknown argument for gateway start: ${parsedModel.positional[0]}`);
  }

  if (parsedModel.provider) {
    provider = parsedModel.provider;
  }
  if (parsedModel.profileId) {
    profileId = parsedModel.profileId;
  }
  if (typeof parsedModel.withTools === 'boolean') {
    withTools = parsedModel.withTools;
  }
  if (Array.isArray(parsedModel.toolAllow)) {
    toolAllow = parsedModel.toolAllow;
  }
  if (typeof parsedModel.toolMaxSteps === 'number') {
    toolMaxSteps = parsedModel.toolMaxSteps;
  }
  if (typeof parsedModel.memory === 'boolean') {
    memory = parsedModel.memory;
  }

  if (provider) {
    const normalizedProvider = provider.trim().toLowerCase();
    if (normalizedProvider.length > 0 && normalizedProvider !== 'openai-codex') {
      throw new Error(`Unsupported feishu provider: ${provider}`);
    }
  }

  const normalizedPairingPolicy = normalizePairingPolicy(pairingPolicy);

  return {
    ...(appId ? { appId } : {}),
    ...(appSecret ? { appSecret } : {}),
    ...(typeof requestTimeoutMs === 'number' && Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0
      ? { requestTimeoutMs }
      : {}),
    ...(provider ? { provider } : {}),
    ...(profileId ? { profileId } : {}),
    ...(typeof withTools === 'boolean' ? { withTools } : {}),
    ...(typeof memory === 'boolean' ? { memory } : {}),
    ...(Array.isArray(toolAllow) ? { toolAllow } : {}),
    ...(typeof toolMaxSteps === 'number' && Number.isFinite(toolMaxSteps) && toolMaxSteps > 0 ? { toolMaxSteps } : {}),
    ...(typeof heartbeatEnabled === 'boolean' ? { heartbeatEnabled } : {}),
    ...(typeof heartbeatIntervalMs === 'number' && Number.isFinite(heartbeatIntervalMs) && heartbeatIntervalMs > 0
      ? { heartbeatIntervalMs }
      : {}),
    ...(heartbeatTargetOpenId?.trim() ? { heartbeatTargetOpenId: heartbeatTargetOpenId.trim() } : {}),
    ...(heartbeatSessionKey?.trim() ? { heartbeatSessionKey: heartbeatSessionKey.trim() } : {}),
    ...(normalizedPairingPolicy ? { pairingPolicy: normalizedPairingPolicy } : {}),
    ...(typeof pairingPendingTtlMs === 'number' && Number.isFinite(pairingPendingTtlMs) && pairingPendingTtlMs > 0
      ? { pairingPendingTtlMs }
      : {}),
    ...(typeof pairingPendingMax === 'number' && Number.isFinite(pairingPendingMax) && pairingPendingMax > 0
      ? { pairingPendingMax }
      : {}),
    ...(Array.isArray(pairingAllowFrom) ? { pairingAllowFrom } : {}),
  };
}

export function parseLocalGatewayArgs(argv: string[]): LocalGatewayOverrides {
  const parsed = parseModelCommandArgs(argv, { allowMemory: true, strictUnknown: true });
  if (parsed.positional.length > 0) {
    throw new Error(`Unknown argument for gateway start: ${parsed.positional[0]}`);
  }

  if (parsed.provider && parsed.provider !== 'openai-codex') {
    throw new Error(`Unsupported provider: ${parsed.provider}`);
  }

  return {
    ...(parsed.provider ? { provider: parsed.provider } : {}),
    ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
    ...(typeof parsed.withTools === 'boolean' ? { withTools: parsed.withTools } : {}),
    ...(typeof parsed.memory === 'boolean' ? { memory: parsed.memory } : {}),
    ...(parsed.toolAllow ? { toolAllow: parsed.toolAllow } : {}),
    ...(typeof parsed.toolMaxSteps === 'number' ? { toolMaxSteps: parsed.toolMaxSteps } : {}),
  };
}

type GatewayStartPlugin = (argv: string[]) => GatewayStartOverrides;

const GATEWAY_CHANNEL_PLUGINS: Record<GatewayChannel, GatewayChannelPlugin> = {
  feishu: {
    name: 'feishu',
    parseStartArgs: parseFeishuServerArgs,
  },
  local: {
    name: 'local',
    parseStartArgs: parseLocalGatewayArgs,
  },
};

function resolveGatewayChannelPlugin(rawChannel: string): GatewayChannelPlugin {
  const channel = rawChannel.trim().toLowerCase();
  const plugin = GATEWAY_CHANNEL_PLUGINS[channel as GatewayChannel];
  if (!plugin) {
    throw new Error(`Unsupported channel: ${rawChannel}`);
  }
  return plugin;
}

function normalizeGatewayChannels(rawChannels: GatewayChannel[]): GatewayChannel[] {
  const output: GatewayChannel[] = [];
  for (const channel of rawChannels) {
    if (!output.includes(channel)) {
      output.push(channel);
    }
  }
  return output;
}

export function parseGatewayArgs(argv: string[]): {
  channels: GatewayChannel[];
  channel: GatewayChannel;
  action: 'start' | 'status' | 'stop';
  appId?: string;
  appSecret?: string;
  requestTimeoutMs?: number;
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  memory?: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
  heartbeatEnabled?: boolean;
  heartbeatIntervalMs?: number;
  heartbeatTargetOpenId?: string;
  heartbeatSessionKey?: string;
  pairingPolicy?: FeishuGatewayConfig['pairingPolicy'];
  pairingPendingTtlMs?: number;
  pairingPendingMax?: number;
  pairingAllowFrom?: string[];
  daemon?: boolean;
  statePath?: string;
  logPath?: string;
  serviceChild?: boolean;
  debug?: boolean;
  serviceArgv: string[];
} {
  let channel: GatewayChannel = 'feishu';
  const channels: GatewayChannel[] = [];
  let hasChannel = false;
  let action: 'start' | 'status' | 'stop' = 'start';
  let daemon = false;
  let statePath: string | undefined;
  let logPath: string | undefined;
  let serviceChild = false;
  let debug = false;
  const startArgs: string[] = [];
  const serviceArgv: string[] = [];
  let actionParsed = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (!actionParsed && !arg.startsWith('--')) {
      if (arg === 'start' || arg === 'status' || arg === 'stop') {
        action = arg;
        actionParsed = true;
        continue;
      }
      throw new Error(`Unknown gateway subcommand: ${arg}`);
    }

    if (arg === '--daemon') {
      if (action !== 'start') {
        throw new Error(`--daemon is only valid for: lainclaw gateway start ...`);
      }
      daemon = true;
      continue;
    }

    if (arg === '--debug') {
      if (action !== 'start') {
        throw new Error(`--debug is only valid for: lainclaw gateway start ...`);
      }
      debug = true;
      serviceArgv.push(arg);
      continue;
    }

    if (arg === '--service-child') {
      serviceChild = true;
      continue;
    }

    if (arg === '--pid-file') {
      throwIfMissingValue('pid-file', i + 1, argv);
      statePath = argv[i + 1];
      serviceArgv.push(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--pid-file=')) {
      statePath = arg.slice('--pid-file='.length);
      if (!statePath) {
        throw new Error('Invalid value for --pid-file');
      }
      serviceArgv.push(arg);
      continue;
    }

    if (arg === '--log-file') {
      throwIfMissingValue('log-file', i + 1, argv);
      logPath = argv[i + 1];
      serviceArgv.push(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--log-file=')) {
      logPath = arg.slice('--log-file='.length);
      if (!logPath) {
        throw new Error('Invalid value for --log-file');
      }
      serviceArgv.push(arg);
      continue;
    }

    if (arg === '--channel') {
      throwIfMissingValue('channel', i + 1, argv);
      channel = resolveGatewayChannelPlugin(argv[i + 1]).name;
      channels.push(channel);
      hasChannel = true;
      serviceArgv.push(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--channel=')) {
      channel = resolveGatewayChannelPlugin(arg.slice('--channel='.length)).name;
      channels.push(channel);
      hasChannel = true;
      serviceArgv.push(arg);
      continue;
    }

    if (arg.startsWith('--')) {
      const isConfigOption = action === 'start';
      if (!isConfigOption) {
        throw new Error(`Unknown option for gateway ${action}: ${arg}`);
      }
      if (!arg.includes('=') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        startArgs.push(arg, argv[i + 1]);
        serviceArgv.push(arg, argv[i + 1]);
        i += 1;
        continue;
      }
      startArgs.push(arg);
      serviceArgv.push(arg);
      continue;
    }

    throw new Error(`Unknown argument for gateway ${action}: ${arg}`);
  }

  if (action === 'start') {
    const normalizedChannels = normalizeGatewayChannels(channels);
    if (!hasChannel && normalizedChannels.length === 0) {
      normalizedChannels.push(channel);
    }
    if (normalizedChannels.length === 0) {
      throw new Error('At least one gateway channel is required');
    }

    const normalizedChannel = normalizedChannels[0];
    if (normalizedChannels.length === 1) {
      const plugin = resolveGatewayChannelPlugin(normalizedChannel);
      const startConfig = plugin.parseStartArgs(startArgs);
      return {
        channel: normalizedChannel,
        channels: normalizedChannels,
        action,
        debug,
        ...startConfig,
        daemon,
        statePath,
        logPath,
        serviceChild,
        serviceArgv,
      };
    }

    const startConfig = parseLocalGatewayArgs(startArgs);
    return {
      channel: normalizedChannel,
      channels: normalizedChannels,
      action,
      debug,
      ...startConfig,
      daemon,
      statePath,
      logPath,
      serviceChild,
      serviceArgv,
    };
  }

  const normalizedChannels = normalizeGatewayChannels(channels);
  if (!hasChannel && normalizedChannels.length === 0) {
    normalizedChannels.push(channel);
  }
  return {
    channel: normalizedChannels[0],
    channels: normalizedChannels,
    action,
    daemon: false,
    statePath,
    logPath,
    serviceChild,
    serviceArgv,
    debug,
  };
}
