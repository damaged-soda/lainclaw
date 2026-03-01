import { Command, Option } from 'commander';
import { runAgentCommand } from '../agent.js';
import { setExitCode } from '../../shared/exitCode.js';

interface ParsedAgentCommand {
  input: string;
  provider?: string;
  profile?: string;
  session?: string;
  newSession?: boolean;
  memory?: boolean;
  withTools?: boolean;
  toolAllow?: string[];
}

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

function normalizeInput(input: string[]): string {
  return input.join(' ').trim();
}

function buildOptions(): Option[] {
  return [
    new Option('--provider <provider>', 'Select model provider by name.'),
    new Option('--profile <profile>', 'Select provider profile.'),
    new Option('--session <name>', 'Use specified session id.'),
    new Option('--new-session', 'Start a fresh session.'),
    new Option('--memory [value]', 'Enable/disable memory persistence for this call.')
      .argParser(parseBooleanFlag)
      .default(undefined),
    new Option('--no-memory'),
    new Option('--with-tools [value]', 'Enable/disable tool calls.')
      .argParser(parseBooleanFlag)
      .default(undefined),
    new Option('--no-with-tools'),
    new Option('--tool-allow <tools>', 'Limit allowed tool names (comma-separated).')
      .argParser(parseCsv),
  ];
}

function readOptions(options: Record<string, unknown>): ParsedAgentCommand {
  return {
    input: '',
    ...(typeof options.provider === 'string' && options.provider.trim() ? { provider: options.provider } : {}),
    ...(typeof options.profile === 'string' && options.profile.trim() ? { profile: options.profile } : {}),
    ...(typeof options.session === 'string' && options.session.trim() ? { session: options.session } : {}),
    ...(options.newSession === true ? { newSession: true } : {}),
    ...(typeof options.memory === 'boolean' ? { memory: options.memory } : {}),
    ...(typeof options.withTools === 'boolean' ? { withTools: options.withTools } : {}),
    ...(Array.isArray(options.toolAllow) ? { toolAllow: options.toolAllow as string[] } : {}),
  };
}

export function buildAgentCommand(program: Command): Command {
  const command = program
    .command('agent')
    .description('Run agent command')
    .argument('[input...]')
    .addHelpText('after', [
      'Examples:',
      '  lainclaw agent 这是一段测试文本',
      '  lainclaw agent --session work --provider <provider> --profile default 这是一段测试输入',
      '  lainclaw agent --session work --memory 这是一个长期记忆测试',
      '  lainclaw agent --session work --memory=off 这是一条不写入记忆的消息',
    ].join('\n'))
    .action(async (input: string[], options: Record<string, unknown>, command: Command) => {
      const parsed: ParsedAgentCommand = readOptions(options);
      const code = await runAgentCommand({
        ...parsed,
        input: normalizeInput(input),
      });
      setExitCode(command, code);
    });

  for (const option of buildOptions()) {
    command.addOption(option);
  }

  return command;
}
