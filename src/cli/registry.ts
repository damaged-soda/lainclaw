import { runAgentCommand } from './commands/agent.js';
import { runAuthCommand } from './commands/auth.js';
import { runHeartbeatCommand } from './commands/heartbeat.js';
import { runPairingCommand } from '../pairing/cli.js';
import { runToolsCommand } from './commands/tools.js';
import { runGatewayCommand } from './commands/gateway/runtime.js';
import type { CommandContext, CommandRoute } from './types.js';

export const commandRoutes: CommandRoute[] = [
  {
    command: 'agent',
    description: 'Run agent command',
    handler: (context: CommandContext) => runAgentCommand(context.args),
  },
  {
    command: 'auth',
    description: 'Run auth command',
    handler: (context: CommandContext) => runAuthCommand(context.args),
  },
  {
    command: 'tools',
    description: 'Run tools command',
    handler: (context: CommandContext) => runToolsCommand(context.args),
  },
  {
    command: 'pairing',
    description: 'Run pairing command',
    handler: (context: CommandContext) => runPairingCommand(context.args),
  },
  {
    command: 'heartbeat',
    description: 'Run heartbeat command',
    handler: (context: CommandContext) => runHeartbeatCommand(context.args),
  },
  {
    command: 'gateway',
    description: 'Run gateway command',
    handler: (context: CommandContext) => runGatewayCommand(context.args),
  },
];

const commandRouteLookup: Map<string, CommandRoute> = new Map(
  commandRoutes.map((route) => [route.command, route]),
);

export function resolveCommandRoute(command: string): CommandRoute | undefined {
  return commandRouteLookup.get(command);
}

export function runUnknownCommand(command: string): Promise<number> {
  console.error(`Unknown command: ${command}`);
  return Promise.resolve(1);
}
