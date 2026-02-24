import { dispatchCommand } from './registry.js';

export async function runCli(argv: string[]): Promise<number> {
  try {
    return await dispatchCommand(argv);
  } catch (error) {
    console.error("ERROR:", String(error instanceof Error ? error.message : error));
    return 1;
  }
}

export { printUsage } from './usage.js';
