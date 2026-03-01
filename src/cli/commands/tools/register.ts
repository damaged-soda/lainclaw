import { Command } from 'commander';
import { runToolsCommand, type ToolsCommandInput } from '../tools.js';

function setExitCode(command: Command, code: number): void {
  (command as { exitCode?: number }).exitCode = code;
}

export function buildToolsCommand(program: Command): Command {
  const tools = program.command('tools').description('Run tools command');

  tools
    .addHelpText(
      'after',
      [
        'Examples:',
        '  lainclaw tools list',
        '  lainclaw tools info <name>',
        '  lainclaw tools invoke <name> --args <json>',
      ].join('\n'),
    );

  tools
    .command('list')
    .description('List tools.')
    .action(async (_options: never, command: Command) => {
      const parsed: ToolsCommandInput = { kind: 'list' };
      const code = await runToolsCommand(parsed);
      setExitCode(command, code);
    });

  tools
    .command('info')
    .description('Show tool info.')
    .argument('<name>', 'Tool name.')
    .action(async (name: string, _options: never, command: Command) => {
      const parsed: ToolsCommandInput = { kind: 'info', name };
      const code = await runToolsCommand(parsed);
      setExitCode(command, code);
    });

  tools
    .command('invoke')
    .description('Invoke tool.')
    .argument('<name>', 'Tool name.')
    .requiredOption('--args <json>', 'Tool arguments in json string.')
    .action(async (name: string, options: { args: string }, command: Command) => {
      const parsed: ToolsCommandInput = {
        kind: 'invoke',
        name,
        rawArgs: options.args,
      };
      const code = await runToolsCommand(parsed);
      setExitCode(command, code);
    });

  return tools;
}
