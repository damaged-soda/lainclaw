import { parseAuthArgs } from '../parsers/auth.js';
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

export async function runAuthCommand(args: string[]): Promise<number> {
  return runCommand(async () => {
    const parsed = parseAuthArgs(args);

    if (parsed.kind === 'missing') {
      console.error('Missing auth subcommand.');
      return 1;
    }

    if (parsed.kind === 'unknown') {
      console.error(`Unknown auth subcommand: ${parsed.subcommand}`);
      return 1;
    }

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
