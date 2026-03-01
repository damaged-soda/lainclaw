import { Command, Option } from 'commander';
import { runCommand } from '../shared/result.js';
import { addHeartbeatRule, initHeartbeatFile, listHeartbeatRules, removeHeartbeatRule, setHeartbeatRuleEnabled } from '../../heartbeat/store.js';
import { runHeartbeatOnce } from '../../heartbeat/runner.js';
import { addModelOptions } from '../shared/options.js';
import { setExitCode } from '../shared/exitCode.js';

export type HeartbeatCommandInput =
  | { kind: 'init'; force?: boolean; templatePath?: string }
  | { kind: 'add'; ruleText: string; provider?: string; profileId?: string; withTools?: boolean; toolAllow?: string[] }
  | { kind: 'list' }
  | { kind: 'remove'; ruleId: string }
  | { kind: 'enable'; ruleId: string }
  | { kind: 'disable'; ruleId: string }
  | { kind: 'run'; provider?: string; profileId?: string; withTools?: boolean; toolAllow?: string[]; memory?: boolean };

export async function runHeartbeatCommand(parsed: HeartbeatCommandInput): Promise<number> {
  return runCommand(async () => {
    if (parsed.kind === 'init') {
      const initResult = await initHeartbeatFile({
        overwrite: parsed.force === true,
        ...(parsed.templatePath ? { templatePath: parsed.templatePath } : {}),
      });
      if (initResult.status === 'skipped') {
        console.log(`Skipped: HEARTBEAT.md already exists: ${initResult.targetPath}`);
        console.log(`Use --force to overwrite with ${initResult.templatePath}`);
        return 0;
      }
      if (initResult.status === 'updated') {
        console.log(`Updated: ${initResult.targetPath}`);
      } else {
        console.log(`Created: ${initResult.targetPath}`);
      }
      console.log(`Template: ${initResult.templatePath}`);
      return 0;
    }

    if (parsed.kind === 'add') {
      const rule = await addHeartbeatRule({
        ruleText: parsed.ruleText,
        ...(parsed.provider ? { provider: parsed.provider } : {}),
        ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
        ...(parsed.toolAllow ? { toolAllow: parsed.toolAllow } : {}),
        ...(typeof parsed.withTools === 'boolean' ? { withTools: parsed.withTools } : {}),
      });
      console.log(`Added heartbeat rule: ${rule.id}`);
      console.log(JSON.stringify(rule, null, 2));
      return 0;
    }

    if (parsed.kind === 'list') {
      const rules = await listHeartbeatRules();
      console.log(JSON.stringify(rules, null, 2));
      return 0;
    }

    if (parsed.kind === 'remove') {
      const removed = await removeHeartbeatRule(parsed.ruleId);
      if (!removed) {
        console.error(`Heartbeat rule not found: ${parsed.ruleId}`);
        return 1;
      }
      console.log(`Removed heartbeat rule: ${parsed.ruleId}`);
      return 0;
    }

    if (parsed.kind === 'enable' || parsed.kind === 'disable') {
      const enabled = parsed.kind === 'enable';
      const updated = await setHeartbeatRuleEnabled(parsed.ruleId, enabled);
      if (!updated) {
        console.error(`Heartbeat rule not found: ${parsed.ruleId}`);
        return 1;
      }
      console.log(`Updated heartbeat rule ${parsed.ruleId}: ${enabled ? 'enabled' : 'disabled'}`);
      return 0;
    }

    const summary = await runHeartbeatOnce({
      ...(parsed.provider ? { provider: parsed.provider } : {}),
      ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
      ...(typeof parsed.withTools === 'boolean' ? { withTools: parsed.withTools } : {}),
      ...(parsed.toolAllow ? { toolAllow: parsed.toolAllow } : {}),
      ...(typeof parsed.memory === 'boolean' ? { memory: parsed.memory } : {}),
    });
    console.log(JSON.stringify(summary, null, 2));
    return summary.errors > 0 ? 1 : 0;
  });
}

interface HeartbeatRuleOptions {
  provider?: string;
  profile?: string;
  withTools?: boolean;
  toolAllow?: string[];
  memory?: boolean;
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
      const code = await runHeartbeatCommand({
        kind: 'init',
        ...(options.force === true ? { force: true } : {}),
        ...(options.template?.trim() ? { templatePath: options.template.trim() } : {}),
      });
      setExitCode(command, code);
    });

  const add = heartbeat
    .command('add')
    .description('Add heartbeat rule.')
    .argument('<ruleText...>', 'Reminder rule body.')
    .action(async (ruleText: string[], options: HeartbeatRuleOptions, command: Command) => {
      const parsed: HeartbeatCommandInput = {
        kind: 'add',
        ruleText: ruleText.join(' '),
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.profile ? { profileId: options.profile } : {}),
        ...(typeof options.withTools === 'boolean' ? { withTools: options.withTools } : {}),
        ...(Array.isArray(options.toolAllow) ? { toolAllow: options.toolAllow } : {}),
      };
      const code = await runHeartbeatCommand(parsed);
      setExitCode(command, code);
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

  const run = heartbeat
    .command('run')
    .description('Run heartbeat once.')
    .action(async (options: HeartbeatRuleOptions, command: Command) => {
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

  addModelOptions(add, {
    providerDescription: 'Model provider override.',
    profileDescription: 'Provider profile override.',
    withToolsDescription: 'Enable/disable tool calls.',
    noWithToolsDescription: 'Disable tool calls.',
    toolAllowDescription: 'Limit allowed tool names (comma-separated).',
  });

  addModelOptions(run, {
    includeMemory: true,
    providerDescription: 'Model provider override.',
    profileDescription: 'Provider profile override.',
    withToolsDescription: 'Enable/disable tool calls.',
    noWithToolsDescription: 'Disable tool calls.',
    toolAllowDescription: 'Limit allowed tool names (comma-separated).',
    memoryDescription: 'Enable/disable memory usage in heartbeat run.',
    noMemoryDescription: 'Disable memory usage in heartbeat run.',
  });

  return heartbeat;
}
