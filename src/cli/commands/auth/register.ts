import { Command } from 'commander';
import { runAuthCommand, type AuthCommandInput } from '../auth.js';

function setExitCode(command: Command, code: number): void {
  (command as { exitCode?: number }).exitCode = code;
}

function normalizeProfile(profile: string | undefined): string | undefined {
  return profile?.trim();
}

export function buildAuthCommand(program: Command): Command {
  const auth = program.command('auth').description('Run auth command').addHelpText(
    'after',
    [
      'Examples:',
      '  lainclaw auth login openai-codex',
      '  lainclaw auth status',
      '  lainclaw auth use <profile>',
      '  lainclaw auth logout [--all|<profile>]',
    ].join('\n'),
  );

  auth
    .command('login')
    .description('Login with provider.')
    .argument('<provider>', 'Auth provider name.')
    .action(async (provider: string, _options: never, command: Command) => {
      const code = await runAuthCommand({ kind: 'login', provider });
      setExitCode(command, code);
    });

  auth
    .command('status')
    .description('Show auth status.')
    .action(async (_options: unknown, command: Command) => {
      const code = await runAuthCommand({ kind: 'status' });
      setExitCode(command, code);
    });

  auth
    .command('use')
    .description('Use a profile as active profile.')
    .argument('<profile>', 'Profile id.')
    .action(async (profile: string, _options: unknown, command: Command) => {
      const code = await runAuthCommand({ kind: 'use', profile: normalizeProfile(profile) });
      setExitCode(command, code);
    });

  auth
    .command('logout')
    .description('Logout and optionally remove profile.')
    .argument('[profile]', 'Profile id.')
    .option('--all', 'Logout all profiles.')
    .action(async (profile: string | undefined, options: { all?: boolean }, command: Command) => {
      const parsed: AuthCommandInput = {
        kind: 'logout',
        all: options.all === true,
        ...(normalizeProfile(profile) ? { profile: normalizeProfile(profile) } : {}),
      };
      const code = await runAuthCommand(parsed);
      setExitCode(command, code);
    });

  return auth;
}
