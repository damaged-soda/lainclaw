import { printUsage } from './legacy.js';
import { VERSION } from './legacy.js';
import { runLegacyCli } from './legacy.js';
import type { CommandContext, CommandHandler } from './types.js';
import { runAgentCommand } from './commands/agent.js';
import { runAuthCommand } from './commands/auth.js';
import { runHeartbeatCommand } from './commands/heartbeat.js';
import { runPairingCommand } from './commands/pairing.js';
import { runToolsCommand } from './commands/tools.js';
import { runGatewayCommand } from './commands/gateway/index.js';

const commandRoutes: Record<string, CommandHandler> = {
  agent: (context) => runAgentCommand(context.args),
  auth: (context) => runAuthCommand(context.args),
  tools: (context) => runToolsCommand(context.args),
  pairing: (context) => runPairingCommand(context.args),
  heartbeat: (context) => runHeartbeatCommand(context.args),
  gateway: (context) => runGatewayCommand(context.args),
};

export async function dispatchCommand(argv: string[]): Promise<number> {
  const command = argv[0];

  if (!command) {
    console.log(printUsage());
    return 0;
  }

  if (command === 'help' || command === '-h' || command === '--help') {
    console.log(printUsage());
    return 0;
  }

  if (command === '-v' || command === '--version') {
    console.log(`lainclaw v${VERSION}`);
    return 0;
  }

  const handler = commandRoutes[command];
  if (!handler) {
    return runLegacyCli(argv);
  }

  const context: CommandContext = {
    command,
    args: argv.slice(1),
    argv,
  };

  return handler(context);
}
