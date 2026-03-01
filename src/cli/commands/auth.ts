import {
  clearProfiles,
  formatProfileExpiry,
  getAuthStatus,
  getAuthStorePath,
  loginOpenAICodexProfile,
  setActiveProfile,
  logoutProfile,
} from '../../auth/authManager.js';
import { runCommand } from '../shared/result.js';
import { Command } from 'commander';
import { setExitCode } from '../shared/exitCode.js';

export type AuthCommandInput =
  | { kind: 'login'; provider?: string }
  | { kind: 'status' }
  | { kind: 'use'; profile?: string }
  | { kind: 'logout'; all: boolean; profile?: string };

export async function runAuthCommand(parsed: AuthCommandInput): Promise<number> {
  return runCommand(async () => {
    if (parsed.kind === 'login') {
      if (!parsed.provider) {
        console.error('Usage: lainclaw auth login <provider>');
        return 1;
      }
      if (parsed.provider !== 'openai-codex') {
        console.error(`Unsupported auth provider: ${parsed.provider}`);
        return 1;
      }

      const profile = await loginOpenAICodexProfile();
      console.log(`Auth profile created: ${profile.id}`);
      console.log(`Credential expires: ${new Date(profile.credential.expires).toISOString()}`);
      console.log(`Use this profile with: lainclaw agent --provider openai-codex --profile ${profile.id} <input>`);
      return 0;
    }

    if (parsed.kind === 'status') {
      const status = await getAuthStatus();
      const storePath = await getAuthStorePath();
      if (status.profiles.length === 0) {
        console.log('No auth profiles configured.');
        console.log('Hint: run "lainclaw auth login openai-codex"');
        console.log(`Profile file: ${storePath}`);
        return 0;
      }
      console.log('Auth profiles:');
      for (const profile of status.profiles) {
        const prefix = status.activeProfileId === profile.id ? '*' : ' ';
        console.log(
          `${prefix} ${profile.id} provider=${profile.provider} expires=${formatProfileExpiry(profile)} account=${profile.credential.accountId ?? '-'}`,
        );
      }
      console.log(`Profile file: ${storePath}`);
      console.log(`Active profile: ${status.activeProfileId ?? '(none)'}`);
      return 0;
    }

    if (parsed.kind === 'use') {
      if (!parsed.profile) {
        console.error('Usage: lainclaw auth use <profile>');
        return 1;
      }
      const profile = await setActiveProfile(parsed.profile);
      console.log(`Active profile set: ${profile.id}`);
      return 0;
    }

    if (parsed.kind === 'logout') {
      if (parsed.all) {
        await clearProfiles();
        console.log('All auth profiles removed.');
        return 0;
      }

      const removed = await logoutProfile(parsed.profile);
      if (!removed) {
        console.log('No active profile to remove.');
        return 0;
      }
      console.log(`Profile removed: ${removed}`);
      return 0;
    }
    return 1;
  });
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
      const code = await runAuthCommand({
        kind: 'logout',
        all: options.all === true,
        ...(normalizeProfile(profile) ? { profile: normalizeProfile(profile) } : {}),
      });
      setExitCode(command, code);
    });

  return auth;
}
