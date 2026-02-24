export type ParsedAuthCommand =
  | { kind: 'missing' }
  | { kind: 'unknown'; subcommand: string }
  | { kind: 'login'; provider?: string }
  | { kind: 'status' }
  | { kind: 'use'; profile?: string }
  | { kind: 'logout'; all: boolean; profile?: string };

export function parseAuthArgs(argv: string[]): ParsedAuthCommand {
  const subcommand = argv[0];
  const args = argv.slice(1);

  if (!subcommand) {
    return { kind: 'missing' };
  }

  if (subcommand === 'login') {
    return { kind: 'login', provider: args[0] };
  }

  if (subcommand === 'status') {
    return { kind: 'status' };
  }

  if (subcommand === 'use') {
    return { kind: 'use', profile: args[0] };
  }

  if (subcommand === 'logout') {
    return {
      kind: 'logout',
      all: args[0] === '--all',
      profile: args[0] === '--all' ? undefined : args[0],
    };
  }

  return { kind: 'unknown', subcommand };
}
