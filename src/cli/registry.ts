import { runAgentCommand } from './commands/agent.js';
import { runAuthCommand } from './commands/auth.js';
import { runHeartbeatCommand } from './commands/heartbeat.js';
import { runPairingCommand } from './commands/pairing.js';
import { runToolsCommand } from './commands/tools.js';
import { runGatewayCommand } from './commands/gateway/runtime.js';
import { COMMAND_DEFINITIONS } from './spec/commands.js';
import type { CommandContext, CommandRoute } from './types.js';

const commandHandlers: Record<string, (context: CommandContext) => Promise<number>> = {
  agent: (context) => runAgentCommand(context.args),
  auth: (context) => runAuthCommand(context.args),
  tools: (context) => runToolsCommand(context.args),
  pairing: (context) => runPairingCommand(context.args),
  heartbeat: (context) => runHeartbeatCommand(context.args),
  gateway: (context) => runGatewayCommand(context.args),
};

export const commandRoutes: CommandRoute[] = COMMAND_DEFINITIONS.flatMap((spec) => {
  const handler = commandHandlers[spec.command];
  if (!handler) {
    return [];
  }

  return [
    {
      command: spec.command,
      description: spec.description,
      handler,
    },
  ];
});

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
