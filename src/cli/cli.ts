import { Command } from 'commander';
import { buildProgram } from './program.js';
import { VERSION } from './version.js';

function installExitOverride(command: Command): void {
  command.exitOverride();
  for (const child of command.commands) {
    installExitOverride(child);
  }
}

function isCommandNotFound(error: unknown): error is Command & { code?: string; message: string } {
  if (!error || typeof error !== 'object') {
    return false;
  }
  return 'code' in error && String((error as Record<string, unknown>).code).startsWith('commander.');
}

export async function runCli(argv: string[]): Promise<number> {
  const program = buildProgram();
  installExitOverride(program);

  try {
    await program.parseAsync(argv, { from: 'user' });
    return (program as { exitCode?: number }).exitCode ?? 0;
  } catch (error) {
    if (isCommandNotFound(error)) {
      const message = String(error.message ?? '');
      if (error.code === 'commander.help' || error.code === 'commander.helpDisplayed') {
        return 0;
      }
      if (error.code === 'commander.version') {
        console.log(`lainclaw v${VERSION}`);
        return 0;
      }
      if (error.code === 'commander.unknownCommand') {
        const match = message.match(/'([^']+)'/);
        if (match?.[1]) {
          console.error(`Unknown command: ${match[1]}`);
        } else {
          console.error(message);
        }
        return 1;
      }
      return Number((error as { exitCode?: number }).exitCode ?? 1);
    }

    console.error('ERROR:', String(error instanceof Error ? error.message : error));
    return 1;
  }
}
