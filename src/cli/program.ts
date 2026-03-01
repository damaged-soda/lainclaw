import { Command } from 'commander';
import { buildAuthCommand } from './commands/auth/register.js';
import { buildGatewayCommand } from './commands/gateway/register.js';
import { buildHeartbeatCommand } from './commands/heartbeat/register.js';
import { buildPairingCommand } from './commands/pairing/register.js';
import { buildToolsCommand } from './commands/tools/register.js';
import { buildAgentCommand } from './commands/agent/register.js';
import { VERSION } from './version.js';

const GLOBAL_NOTES = 'Notes: `provider` 决定运行适配器；未配置或配置错误会直接报错。provider 与 profile 用于查找对应运行配置。';

function setExitCode(command: Command, code: number): void {
  (command as { exitCode?: number }).exitCode = code;
}

export function buildProgram(): Command {
  const program = new Command('lainclaw');

  program
    .description('Lainclaw command line interface')
    .addHelpText('beforeAll', `${GLOBAL_NOTES}\n`)
    .helpOption('-h, --help', 'display help for command')
    .option('-v, --version', 'display version')
    .allowExcessArguments(true)
    .action((options, command) => {
      const normalized = command.opts();
      if (normalized.version) {
        console.log(`lainclaw v${VERSION}`);
        setExitCode(command, 0);
        return;
      }

      if (command.args.length > 0) {
        console.error(`Unknown command: ${command.args[0]}`);
        setExitCode(command, 1);
        return;
      }

      if (command.args.length === 0) {
        command.outputHelp();
        setExitCode(command, 0);
      }
    });

  buildAgentCommand(program);
  buildAuthCommand(program);
  buildToolsCommand(program);
  buildPairingCommand(program);
  buildHeartbeatCommand(program);
  buildGatewayCommand(program);

  return program;
}

export { Command };
