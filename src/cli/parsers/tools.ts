import { throwIfMissingValue } from '../shared/args.js';

export type ParsedToolsCommand =
  | { kind: 'missing' }
  | { kind: 'unknown'; subcommand: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'list' }
  | { kind: 'info'; name: string }
  | { kind: 'invoke'; name: string; rawArgs?: string };

export function parseToolsArgs(argv: string[]): ParsedToolsCommand {
  const subcommand = argv[0];
  const args = argv.slice(1);

  if (!subcommand) {
    return { kind: 'missing' };
  }

  if (subcommand === 'list') {
    return { kind: 'list' };
  }

  if (subcommand === 'info') {
    const name = args[0];
    if (!name) {
      return { kind: 'invalid', message: 'Usage: lainclaw tools info <name>' };
    }
    return { kind: 'info', name };
  }

  if (subcommand === 'invoke') {
    const name = args[0];
    if (!name) {
      return { kind: 'invalid', message: 'Usage: lainclaw tools invoke <name> --args <json>' };
    }

    let rawArgs: string | undefined;
    for (let i = 1; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === '--args') {
        throwIfMissingValue('args', i + 1, args);
        rawArgs = args[i + 1];
        i += 1;
        continue;
      }

      if (arg.startsWith('--args=')) {
        rawArgs = arg.slice('--args='.length);
        continue;
      }

      if (arg.startsWith('--')) {
        return { kind: 'invalid', message: `Unknown option: ${arg}` };
      }
    }

    return { kind: 'invoke', name, rawArgs };
  }

  return { kind: 'unknown', subcommand };
}
