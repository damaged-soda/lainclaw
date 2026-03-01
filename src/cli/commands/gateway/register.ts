import { Command, Option } from 'commander';
import { runGatewayCommand } from './runtime.js';
import { parseGatewayArgs } from '../../../gateway/runtime/cli/parseGatewayArgs.js';
import { parseGatewayConfigArgs } from '../../../gateway/runtime/cli/parseGatewayConfigArgs.js';

type GatewayCommonOptions = {
  channel?: string | string[];
  pidFile?: string;
  logFile?: string;
  serviceChild?: boolean;
  provider?: string;
  profile?: string;
  withTools?: boolean;
  toolAllow?: string[];
  memory?: boolean;
  heartbeatEnabled?: boolean;
  heartbeatIntervalMs?: string | number;
  heartbeatTargetOpenId?: string;
  heartbeatSessionKey?: string;
  pairingPolicy?: string;
  pairingAllowFrom?: string[];
  pairingPendingTtlMs?: string | number;
  pairingPendingMax?: number | string;
  appId?: string;
  appSecret?: string;
  requestTimeoutMs?: string | number;
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
  toolAllow?: string[];
  memory?: boolean;
  heartbeatEnabled?: boolean;
  heartbeatIntervalMs?: string | number;
  heartbeatTargetOpenId?: string;
  heartbeatSessionKey?: string;
  pairingPolicy?: string;
  pairingAllowFrom?: string[];
  pairingPendingTtlMs?: string | number;
  pairingPendingMax?: string | number;
  requestTimeoutMs?: string | number;
  dryRun?: boolean;
};

type GatewayStatusStopOptions = {
  channel?: string | string[];
  pidFile?: string;
  logFile?: string;
};

function setExitCode(command: Command, code: number): void {
  (command as { exitCode?: number }).exitCode = code;
}

function parseBooleanFlag(raw: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (normalized === '1' || normalized === 'on' || normalized === 'yes' || normalized === 'true') {
    return true;
  }
  if (normalized === '0' || normalized === 'off' || normalized === 'no' || normalized === 'false') {
    return false;
  }
  throw new Error(`Invalid value for boolean option: ${raw}`);
}

function parseCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseGatewayStringOptions(
  options: GatewayCommonOptions | GatewayConfigOptions | GatewayStartOptions,
): string[] {
  return toArgv(options);
}

function toArgv(
  options: GatewayCommonOptions | GatewayConfigOptions | GatewayStartOptions,
): string[] {
  const normalized = options as GatewayCommonOptions & GatewayStartOptions;
  const argv: string[] = [];
  appendMultiString(argv, 'channel', normalized.channel);
  appendString(argv, 'pid-file', normalized.pidFile);
  appendString(argv, 'log-file', normalized.logFile);
  appendBoolean(argv, 'service-child', normalized.serviceChild);
  appendString(argv, 'provider', normalized.provider);
  appendString(argv, 'profile', normalized.profile);
  appendBoolean(argv, 'with-tools', normalized.withTools);
  appendStringList(argv, 'tool-allow', normalized.toolAllow);
  appendBoolean(argv, 'memory', normalized.memory);
  appendBoolean(argv, 'heartbeat-enabled', normalized.heartbeatEnabled);
  appendNumber(argv, 'heartbeat-interval-ms', normalized.heartbeatIntervalMs);
  appendString(argv, 'heartbeat-target-open-id', normalized.heartbeatTargetOpenId);
  appendString(argv, 'heartbeat-session-key', normalized.heartbeatSessionKey);
  appendString(argv, 'pairing-policy', normalized.pairingPolicy);
  appendStringList(argv, 'pairing-allow-from', normalized.pairingAllowFrom);
  appendNumber(argv, 'pairing-pending-ttl-ms', normalized.pairingPendingTtlMs);
  appendNumber(argv, 'pairing-pending-max', normalized.pairingPendingMax);
  appendString(argv, 'app-id', normalized.appId);
  appendString(argv, 'app-secret', normalized.appSecret);
  appendNumber(argv, 'request-timeout-ms', normalized.requestTimeoutMs);
  appendBoolean(argv, 'debug', normalized.debug);
  appendBoolean(argv, 'daemon', normalized.daemon);
  return argv;
}

function parseGatewayStatusStopArgv(options: GatewayStatusStopOptions): string[] {
  const argv: string[] = [];
  appendMultiString(argv, 'channel', options.channel);
  appendString(argv, 'pid-file', options.pidFile);
  appendString(argv, 'log-file', options.logFile);
  return argv;
}

function buildGatewayConfigSetArgv(command: 'set' | 'show' | 'clear' | 'migrate', options: GatewayConfigOptions): string[] {
  if (command === 'show' || command === 'clear') {
    return [
      command,
      ...(typeof options.channel === 'string' ? [`--channel`, options.channel] : []),
    ];
  }
  if (command === 'migrate') {
    return [
      command,
      ...(typeof options.channel === 'string' ? [`--channel`, options.channel] : []),
      ...(options.dryRun ? ['--dry-run'] : []),
    ];
  }

  const argv = [command, ...parseGatewayStringOptions(options)];
  return argv;
}

function appendBoolean(argv: string[], key: string, value: boolean | undefined): void {
  if (value === undefined) {
    return;
  }
  argv.push(value ? `--${key}` : `--no-${key}`);
}

function appendString(argv: string[], key: string, value: string | undefined): void {
  if (typeof value !== 'string' || value.length === 0) {
    return;
  }
  argv.push(`--${key}`, value);
}

function appendNumber(argv: string[], key: string, value: string | number | undefined): void {
  if (typeof value === 'string' && value.trim().length > 0) {
    argv.push(`--${key}`, value.trim());
    return;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return;
  }
  argv.push(`--${key}`, `${value}`);
}

function appendStringList(argv: string[], key: string, values: string[] | undefined): void {
  if (!Array.isArray(values) || values.length === 0) {
    return;
  }
  argv.push(`--${key}`, values.join(','));
}

function appendMultiString(argv: string[], key: string, value: string | string[] | undefined): void {
  if (typeof value === 'string') {
    if (value.trim().length > 0) {
      argv.push(`--${key}`, value);
    }
    return;
  }
  if (!Array.isArray(value)) {
    return;
  }
  for (const item of value) {
    if (typeof item === 'string' && item.trim().length > 0) {
      argv.push(`--${key}`, item);
    }
  }
}

function buildGatewayStartOptions(command: Command): void {
  command
    .addOption(new Option('--channel <channel...>', 'Select gateway runtime channel.'))
    .addOption(new Option('--pid-file <path>', 'Gateway service state file path.'))
    .addOption(new Option('--log-file <path>', 'Gateway service log file path.'))
    .addOption(new Option('--service-child', 'Run gateway process as child service.'))
    .addOption(new Option('--provider <provider>', 'Model provider override.'))
    .addOption(new Option('--profile <profile>', 'Model profile override.'))
    .addOption(new Option('--with-tools [value]', 'Enable/disable tool calls.')
      .argParser(parseBooleanFlag)
      .default(undefined))
    .addOption(new Option('--no-with-tools'))
    .addOption(new Option('--tool-allow <tools>', 'Limit allowed tool names.')
      .argParser(parseCsv))
    .addOption(new Option('--memory [value]', 'Enable/disable memory persistence.')
      .argParser(parseBooleanFlag)
      .default(undefined))
    .addOption(new Option('--no-memory'))
    .addOption(new Option('--heartbeat-enabled [value]', 'Enable/disable heartbeat behavior.')
      .argParser(parseBooleanFlag)
      .default(undefined))
    .addOption(new Option('--no-heartbeat-enabled'))
    .addOption(new Option('--heartbeat-interval-ms <ms>', 'Heartbeat interval in ms.'))
    .addOption(new Option('--heartbeat-target-open-id <openId>', 'Heartbeat target open-id.'))
    .addOption(new Option('--heartbeat-session-key <key>', 'Heartbeat session key.'))
    .addOption(new Option('--pairing-policy <open|allowlist|pairing|disabled>', 'Pairing policy.'))
    .addOption(new Option('--pairing-allow-from <ids>', 'Pairing allowlist.'))
    .addOption(new Option('--pairing-pending-ttl-ms <ms>', 'Pairing pending TTL in ms.'))
    .addOption(new Option('--pairing-pending-max <n>', 'Pairing pending max count.'))
    .addOption(new Option('--app-id <id>', 'Feishu app id.'))
    .addOption(new Option('--app-secret <secret>', 'Feishu app secret.'))
    .addOption(new Option('--request-timeout-ms <ms>', 'Request timeout ms.'))
    .addOption(new Option('--debug', 'Enable local debug output.'))
    .addOption(new Option('--daemon', 'Run gateway service in daemon mode.'));
}

function buildGatewayConfigOptions(command: Command): void {
  command
    .addOption(new Option('--channel <channel>', 'Select gateway config channel.'))
    .addOption(new Option('--provider <provider>', 'Persist provider override.'))
    .addOption(new Option('--profile <profile>', 'Persist profile override.'))
    .addOption(new Option('--app-id <id>', 'Persist feishu app id.'))
    .addOption(new Option('--app-secret <secret>', 'Persist feishu app secret.'))
    .addOption(new Option('--with-tools [value]', 'Persist with-tools default.')
      .argParser(parseBooleanFlag)
      .default(undefined))
    .addOption(new Option('--no-with-tools'))
    .addOption(new Option('--tool-allow <tools>', 'Persist tool allow list.')
      .argParser(parseCsv))
    .addOption(new Option('--memory [value]', 'Persist memory behavior.')
      .argParser(parseBooleanFlag)
      .default(undefined))
    .addOption(new Option('--no-memory'))
    .addOption(new Option('--heartbeat-enabled [value]', 'Persist heartbeat status.')
      .argParser(parseBooleanFlag)
      .default(undefined))
    .addOption(new Option('--no-heartbeat-enabled'))
    .addOption(new Option('--heartbeat-interval-ms <ms>', 'Persist heartbeat interval ms.'))
    .addOption(new Option('--heartbeat-target-open-id <openId>', 'Persist heartbeat target.'))
    .addOption(new Option('--heartbeat-session-key <key>', 'Persist heartbeat session key.'))
    .addOption(new Option('--pairing-policy <open|allowlist|pairing|disabled>', 'Persist pairing policy.'))
    .addOption(new Option('--pairing-allow-from <ids>', 'Persist pairing allowlist.'))
    .addOption(new Option('--pairing-pending-ttl-ms <ms>', 'Persist pairing pending ttl.'))
    .addOption(new Option('--pairing-pending-max <n>', 'Persist pairing pending max.'))
    .addOption(new Option('--request-timeout-ms <ms>', 'Persist request timeout ms.'));
}

function runGatewayStart(argv: string[]): Promise<number> {
  return runGatewayCommand(parseGatewayArgs(argv));
}

function runGatewayConfig(command: 'set' | 'show' | 'clear' | 'migrate', options: GatewayConfigOptions): Promise<number> {
  return runGatewayCommand(parseGatewayConfigArgs(buildGatewayConfigSetArgv(command, options)));
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
        '  lainclaw gateway config <set|show|clear|migrate> [options]',
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
      '  gateway config migrate requires --dry-run',
    ].join('\n'));

  buildGatewayStartOptions(gateway);
  gateway.action(async (options: GatewayStartOptions, command: Command) => {
    setExitCode(command, await runGatewayStart(toArgv(options)));
  });

  const start = gateway.command('start').description('Start gateway service.');
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
      setExitCode(command, await runGatewayStart(['start', ...toArgv(options)]));
    });

  const status = gateway.command('status').description('Show gateway service status.');
  status
    .addHelpText(
      'after',
      [
        'Examples:',
        '  lainclaw gateway status --channel feishu',
        '  lainclaw gateway status --pid-file ./service.json',
      ].join('\n'),
    )
    .addOption(new Option('--channel <channel...>', 'Select gateway runtime channel.'))
    .addOption(new Option('--pid-file <path>', 'Gateway service state file path.'))
    .addOption(new Option('--log-file <path>', 'Gateway service log file path.'))
    .action(async (options: GatewayStatusStopOptions, command: Command) => {
      setExitCode(command, await runGatewayStart(['status', ...parseGatewayStatusStopArgv(options)]));
    });

  const stop = gateway.command('stop').description('Stop gateway service.');
  stop
    .addHelpText(
      'after',
      [
        'Examples:',
        '  lainclaw gateway stop --channel feishu',
        '  lainclaw gateway stop --log-file ./service.log',
      ].join('\n'),
    )
    .addOption(new Option('--channel <channel...>', 'Select gateway runtime channel.'))
    .addOption(new Option('--pid-file <path>', 'Gateway service state file path.'))
    .addOption(new Option('--log-file <path>', 'Gateway service log file path.'))
    .action(async (options: GatewayStatusStopOptions, command: Command) => {
      setExitCode(command, await runGatewayStart(['stop', ...parseGatewayStatusStopArgv(options)]));
    });

  const config = gateway.command('config').description('Manage gateway config.');
  const set = config.command('set').description('Set gateway config fields.');
  buildGatewayConfigOptions(set);
  set.addHelpText('after', ['Examples:', '  lainclaw gateway config set --app-id <appId> --app-secret <appSecret>'].join('\n'));
  set.action(async (options: GatewayConfigOptions, command: Command) => {
    setExitCode(command, await runGatewayConfig('set', options));
  });

  const show = config.command('show').description('Show gateway config.');
  show.addOption(new Option('--channel <channel>', 'Select gateway config channel.'));
  show.action(async (options: GatewayConfigOptions, command: Command) => {
    setExitCode(command, await runGatewayConfig('show', options));
  });

  const clear = config.command('clear').description('Clear gateway config.');
  clear.addOption(new Option('--channel <channel>', 'Select gateway config channel.'));
  clear.addHelpText('after', ['Examples:', '  lainclaw gateway config clear --channel feishu'].join('\n'));
  clear.action(async (options: GatewayConfigOptions, command: Command) => {
    setExitCode(command, await runGatewayConfig('clear', options));
  });

  const migrate = config.command('migrate').description('Migrate legacy config.');
  migrate
    .addOption(new Option('--channel <channel>', 'Select gateway config channel.'))
    .addOption(new Option('--dry-run', 'Show migration draft only.'));
  migrate.addHelpText('after', ['Examples:', '  lainclaw gateway config migrate --channel feishu --dry-run'].join('\n'));
  migrate.action(async (options: GatewayConfigOptions, command: Command) => {
    setExitCode(command, await runGatewayConfig('migrate', { ...options, dryRun: options.dryRun || false }));
  });

  return gateway;
}
