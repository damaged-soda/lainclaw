import { printUsage } from './usage.js';
import { VERSION } from './version.js';
import { resolveCommandRoute, runUnknownCommand } from './registry.js';
import type { CommandContext } from './types.js';

export async function runCli(argv: string[]): Promise<number> {
  try {
    return await dispatchCommand(argv);
  } catch (error) {
    console.error("ERROR:", String(error instanceof Error ? error.message : error));
    return 1;
  }
}

export async function dispatchCommand(argv: string[]): Promise<number> {
  const command = argv[0];

  if (!command || command === 'help' || command === '-h' || command === '--help') {
    console.log(printUsage());
    return 0;
  }

  if (command === '-v' || command === '--version') {
    console.log(`lainclaw v${VERSION}`);
    return 0;
  }

  const route = resolveCommandRoute(command);
  if (!route) {
    return runUnknownCommand(command);
  }

  const context: CommandContext = {
    command,
    args: argv.slice(1),
    argv,
  };

  return route.handler(context);
}

export { printUsage } from './usage.js';
