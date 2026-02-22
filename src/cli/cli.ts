import { ValidationError } from '../shared/types.js';
import { runAsk } from '../gateway/askGateway.js';
import {
  clearProfiles,
  formatProfileExpiry,
  getAuthStatus,
  getAuthStorePath,
  loginOpenAICodexProfile,
  setActiveProfile,
  logoutProfile,
} from '../auth/authManager.js';

const VERSION = '0.1.0';

export function printUsage(): string {
  return [
    'Usage:',
    '  lainclaw --help',
    '  lainclaw --version',
    '  lainclaw ask <input>',
    '  lainclaw ask [--provider <provider>] [--profile <profile>] [--session <name>] [--new-session] <input>',
    '  lainclaw auth login openai-codex',
    '  lainclaw auth status',
    '  lainclaw auth use <profile>',
    '  lainclaw auth logout [--all|<profile>]',
    '',
    'Examples:',
    '  lainclaw ask 这是一段测试文本',
    '  lainclaw ask --session work --provider openai-codex --profile default 这是一段测试文本',
    '  lainclaw auth login openai-codex',
    '  lainclaw auth status',
    '',
    'Notes: model is currently stubbed for MVP and runs fully offline.'
  ].join('\n');
}

function printResult(payload: {
  success: boolean;
  requestId: string;
  createdAt: string;
  route: string;
  stage: string;
  result: string;
  sessionKey: string;
  sessionId: string;
  provider?: string;
  profileId?: string;
}) {
  if (payload.success) {
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }
  return 1;
}

function throwIfMissingValue(label: string, index: number, args: string[]) {
  const next = args[index];
  if (!next || next.startsWith("--")) {
    throw new Error(`Missing value for ${label}`);
  }
}

function parseAskArgs(argv: string[]): {
  input: string;
  provider?: string;
  profile?: string;
  sessionKey?: string;
  newSession?: boolean;
} {
  let provider: string | undefined;
  let profile: string | undefined;
  let sessionKey: string | undefined;
  let newSession = false;
  const inputParts: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--provider") {
      throwIfMissingValue("provider", i + 1, argv);
      provider = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--profile") {
      throwIfMissingValue("profile", i + 1, argv);
      profile = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith("--provider=")) {
      provider = arg.slice("--provider=".length);
      continue;
    }

    if (arg === "--session") {
      throwIfMissingValue("session", i + 1, argv);
      sessionKey = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith("--session=")) {
      sessionKey = arg.slice("--session=".length);
      continue;
    }

    if (arg === "--new-session") {
      newSession = true;
      continue;
    }

    if (arg.startsWith("--profile=")) {
      profile = arg.slice("--profile=".length);
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    inputParts.push(arg);
  }

  return { input: inputParts.join(" "), provider, profile, sessionKey, newSession };
}

async function runAuthCommand(argv: string[]): Promise<number> {
  const [, ...rest] = argv;
  const subcommand = rest[0];
  const args = rest.slice(1);

  if (!subcommand) {
    console.error("Missing auth subcommand.");
    return 1;
  }

  if (subcommand === "login") {
    const provider = args[0];
    if (!provider) {
      console.error("Usage: lainclaw auth login <provider>");
      return 1;
    }
    if (provider !== "openai-codex") {
      console.error(`Unsupported auth provider: ${provider}`);
      return 1;
    }

    const profile = await loginOpenAICodexProfile();
    console.log(`Auth profile created: ${profile.id}`);
    console.log(`Credential expires: ${new Date(profile.credential.expires).toISOString()}`);
    console.log(`Use this profile with: lainclaw ask --provider openai-codex --profile ${profile.id} <input>`);
    return 0;
  }

  if (subcommand === "status") {
    const status = await getAuthStatus();
    const storePath = await getAuthStorePath();
    if (status.profiles.length === 0) {
      console.log("No auth profiles configured.");
      console.log(`Hint: run "lainclaw auth login openai-codex"`);
      console.log(`Profile file: ${storePath}`);
      return 0;
    }
    console.log("Auth profiles:");
    for (const profile of status.profiles) {
      const prefix = status.activeProfileId === profile.id ? "*" : " ";
      console.log(
        `${prefix} ${profile.id} provider=${profile.provider} expires=${formatProfileExpiry(profile)} account=${profile.credential.accountId ?? "-"}`,
      );
    }
    console.log(`Profile file: ${storePath}`);
    console.log(`Active profile: ${status.activeProfileId ?? "(none)"}`);
    return 0;
  }

  if (subcommand === "use") {
    const profileId = args[0];
    if (!profileId) {
      console.error("Usage: lainclaw auth use <profile>");
      return 1;
    }
    const profile = await setActiveProfile(profileId);
    console.log(`Active profile set: ${profile.id}`);
    return 0;
  }

  if (subcommand === "logout") {
    if (args[0] === "--all") {
      await clearProfiles();
      console.log("All auth profiles removed.");
      return 0;
    }

    const target = args[0];
    const removed = await logoutProfile(target);
    if (!removed) {
      console.log("No active profile to remove.");
      return 0;
    }
    console.log(`Profile removed: ${removed}`);
    return 0;
  }

  console.error(`Unknown auth subcommand: ${subcommand}`);
  return 1;
}

export async function runCli(argv: string[]): Promise<number> {
  const command = argv[0];

  if (!command || command === 'help' || command === '-h' || command === '--help') {
    console.log(printUsage());
    return 0;
  }

  if (command === '-v' || command === '--version') {
    console.log(`lainclaw v${VERSION}`);
    return 0;
  }

  if (command === 'ask') {
    try {
      const { input, provider, profile, sessionKey, newSession } = parseAskArgs(argv.slice(1));
      if (provider && provider !== "openai-codex") {
        throw new ValidationError(`Unsupported provider: ${provider}`, "UNSUPPORTED_PROVIDER");
      }
      if (!input) {
        throw new ValidationError("ask command requires non-empty input", "ASK_INPUT_REQUIRED");
      }
      const response = await runAsk(input, {
        ...(provider ? { provider } : {}),
        ...(profile ? { profileId: profile } : {}),
        ...(sessionKey ? { sessionKey } : {}),
        ...(newSession ? { newSession } : {}),
      });
      return printResult(response);
    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(`[${error.code}] ${error.message}`);
        console.error("Usage: lainclaw ask <input>");
        return 1;
      }
      console.error("ERROR:", String(error instanceof Error ? error.message : error));
      return 1;
    }
  }

  if (command === 'auth') {
    try {
      return await runAuthCommand(argv);
    } catch (error) {
      console.error("ERROR:", String(error instanceof Error ? error.message : error));
      return 1;
    }
  }

  console.error(`Unknown command: ${command}`);
  console.error('Try: lainclaw --help');
  return 1;
}
