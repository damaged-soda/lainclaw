import { Command, Option } from 'commander';
import { runHeartbeatCommand, type HeartbeatCommandInput } from '../heartbeat.js';
import { setExitCode } from '../../shared/exitCode.js';

function parseBooleanFlag(raw?: string): boolean {
  if (raw === undefined) {
    return true;
  }
  const normalized = String(raw).trim().toLowerCase();
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

export function buildHeartbeatCommand(program: Command): Command {
  const heartbeat = program.command('heartbeat').description('Run heartbeat command');
  heartbeat.addHelpText(
    'after',
    [
      'Examples:',
      '  lainclaw heartbeat init [--template <path>] [--force]',
      '  lainclaw heartbeat add "提醒我：每天中午检查邮件"',
      '  lainclaw heartbeat list',
      '  lainclaw heartbeat enable <ruleId>',
      '  lainclaw heartbeat disable <ruleId>',
      '  lainclaw heartbeat run',
      '  lainclaw heartbeat remove <ruleId>',
    ].join('\n'),
  );

  heartbeat
    .command('init')
    .description('Initialize HEARTBEAT.md.')
    .addOption(new Option('--template <path>', 'Use template file path.'))
    .option('--force', 'Overwrite existing HEARTBEAT.md.')
    .action(async (options: { template?: string; force?: boolean }, command: Command) => {
      const parsed: HeartbeatCommandInput = {
        kind: 'init',
        ...(options.force === true ? { force: true } : {}),
        ...(options.template?.trim() ? { templatePath: options.template.trim() } : {}),
      };
      setExitCode(command, await runHeartbeatCommand(parsed));
    });

  heartbeat
    .command('add')
    .description('Add heartbeat rule.')
    .argument('<ruleText...>', 'Reminder rule body.')
    .addOption(new Option('--provider <provider>', 'Model provider override.'))
    .addOption(new Option('--profile <profile>', 'Provider profile override.'))
    .addOption(new Option('--with-tools [value]', 'Enable/disable tool calls.')
      .argParser(parseBooleanFlag)
      .default(undefined))
    .addOption(new Option('--no-with-tools'))
    .addOption(new Option('--tool-allow <tools>', 'Limit allowed tool names (comma-separated).')
      .argParser(parseCsv))
    .action(async (
      ruleText: string[],
      options: {
        provider?: string;
        profile?: string;
        withTools?: boolean;
        toolAllow?: string[];
      },
      command: Command,
    ) => {
      const parsed: HeartbeatCommandInput = {
        kind: 'add',
        ruleText: ruleText.join(' '),
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.profile ? { profileId: options.profile } : {}),
        ...(typeof options.withTools === 'boolean' ? { withTools: options.withTools } : {}),
        ...(Array.isArray(options.toolAllow) ? { toolAllow: options.toolAllow } : {}),
      };
      setExitCode(command, await runHeartbeatCommand(parsed));
    });

  heartbeat
    .command('list')
    .description('List heartbeat rules.')
    .action(async (_options: never, command: Command) => {
      setExitCode(command, await runHeartbeatCommand({ kind: 'list' }));
    });

  heartbeat
    .command('remove')
    .description('Remove heartbeat rule.')
    .argument('<ruleId>', 'Rule id.')
    .action(async (ruleId: string, _options: never, command: Command) => {
      setExitCode(command, await runHeartbeatCommand({ kind: 'remove', ruleId }));
    });

  heartbeat
    .command('enable')
    .description('Enable heartbeat rule.')
    .argument('<ruleId>', 'Rule id.')
    .action(async (ruleId: string, _options: never, command: Command) => {
      setExitCode(command, await runHeartbeatCommand({ kind: 'enable', ruleId }));
    });

  heartbeat
    .command('disable')
    .description('Disable heartbeat rule.')
    .argument('<ruleId>', 'Rule id.')
    .action(async (ruleId: string, _options: never, command: Command) => {
      setExitCode(command, await runHeartbeatCommand({ kind: 'disable', ruleId }));
    });

  heartbeat
    .command('run')
    .description('Run heartbeat once.')
    .addOption(new Option('--provider <provider>', 'Model provider override.'))
    .addOption(new Option('--profile <profile>', 'Provider profile override.'))
    .addOption(new Option('--with-tools [value]', 'Enable/disable tool calls.')
      .argParser(parseBooleanFlag)
      .default(undefined))
    .addOption(new Option('--no-with-tools'))
    .addOption(new Option('--tool-allow <tools>', 'Limit allowed tool names (comma-separated).')
      .argParser(parseCsv))
    .addOption(new Option('--memory [value]', 'Enable/disable memory usage in heartbeat run.')
      .argParser(parseBooleanFlag)
      .default(undefined))
    .addOption(new Option('--no-memory'))
    .action(async (
      options: {
        provider?: string;
        profile?: string;
        withTools?: boolean;
        toolAllow?: string[];
        memory?: boolean;
      },
      command: Command,
    ) => {
      const parsed: HeartbeatCommandInput = {
        kind: 'run',
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.profile ? { profileId: options.profile } : {}),
        ...(typeof options.withTools === 'boolean' ? { withTools: options.withTools } : {}),
        ...(Array.isArray(options.toolAllow) ? { toolAllow: options.toolAllow } : {}),
        ...(typeof options.memory === 'boolean' ? { memory: options.memory } : {}),
      };
      setExitCode(command, await runHeartbeatCommand(parsed));
    });

  return heartbeat;
}
