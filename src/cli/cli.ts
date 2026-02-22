import { ValidationError } from '../shared/types.js';
import { runAsk } from '../gateway/askGateway.js';
import { runFeishuGatewayServer } from '../channels/feishu/server.js';
import { getToolInfo, invokeToolByCli, listToolsCatalog } from '../tools/gateway.js';
import {
  clearProfiles,
  formatProfileExpiry,
  getAuthStatus,
  getAuthStorePath,
  loginOpenAICodexProfile,
  setActiveProfile,
  logoutProfile,
} from '../auth/authManager.js';
import type { ToolExecutionLog } from '../tools/types.js';

const VERSION = '0.1.0';

export function printUsage(): string {
  return [
    'Usage:',
    '  lainclaw --help',
    '  lainclaw --version',
    '  lainclaw ask <input>',
    '  lainclaw ask [--provider <provider>] [--profile <profile>] [--session <name>] [--new-session] [--memory|--no-memory|--memory=on|off] [--with-tools|--no-with-tools|--with-tools=true|false] [--tool-allow <tool1,tool2>] [--tool-max-steps <N>] <input>',
    '  lainclaw feishu [--app-id <id>] [--app-secret <secret>] [--request-timeout-ms <ms>]',
    '  lainclaw feishu（未传入参数时，优先使用上次启动写入的 ~/.lainclaw/feishu-gateway.json）',
    '  lainclaw tools list',
    '  lainclaw tools info <name>',
    '  lainclaw tools invoke <name> --args <json>',
    '  lainclaw auth login openai-codex',
    '  lainclaw auth status',
    '  lainclaw auth use <profile>',
    '  lainclaw auth logout [--all|<profile>]',
    '',
    'Examples:',
    '  lainclaw ask 这是一段测试文本',
    '  lainclaw ask --session work --provider openai-codex --profile default 这是一段测试文本',
    '  lainclaw ask --session work --memory 这是一个长期记忆测试',
    '  lainclaw ask --session work --memory=off 这是一条不写入记忆的消息',
    '  lainclaw ask --tool-allow time.now,shell.pwd "tool:time.now"',
    '  lainclaw ask --tool-max-steps 2 --provider openai-codex "请帮我看下时间"',
    '  lainclaw tools invoke fs.read_file --args "{\\"path\\":\\"README.md\\"}"',
    '  lainclaw auth login openai-codex',
    '  lainclaw auth status',
    '',
    'Notes: model is currently stubbed for MVP and runs fully offline.'
  ].join('\n');
}

function parseMemoryFlag(raw: string, index: number): boolean {
  if (raw === '--memory') {
    return true;
  }

  if (raw === '--no-memory') {
    return false;
  }

  if (raw.startsWith('--memory=')) {
    const value = raw.slice('--memory='.length).toLowerCase();
    if (value === 'on' || value === 'true' || value === '1') {
      return true;
    }
    if (value === 'off' || value === 'false' || value === '0') {
      return false;
    }
    throw new Error(`Invalid value for --memory at arg ${index + 1}: ${value}`);
  }

  return false;
}

function parseBooleanFlag(raw: string, index: number): boolean {
  if (raw === '--with-tools') {
    return true;
  }

  if (raw === '--no-with-tools') {
    return false;
  }

  if (raw.startsWith('--with-tools=')) {
    const value = raw.slice('--with-tools='.length).toLowerCase();
    if (value === 'on' || value === 'true' || value === '1') {
      return true;
    }
    if (value === 'off' || value === 'false' || value === '0') {
      return false;
    }
    throw new Error(`Invalid value for --with-tools at arg ${index + 1}: ${value}`);
  }

  throw new Error(`Invalid boolean flag: ${raw}`);
}

function parsePositiveIntValue(raw: string, index: number, label: string): number {
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized) || normalized.length === 0) {
    throw new Error(`Invalid value for ${label} at arg ${index}: ${raw}`);
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid value for ${label} at arg ${index}: ${raw}`);
  }
  return parsed;
}

function parseCsvOption(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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
  memoryEnabled: boolean;
  memoryUpdated: boolean;
  memoryFile?: string;
  provider?: string;
  profileId?: string;
  toolCalls?: { id: string; name: string; args?: unknown; source?: string }[];
  toolResults?: ToolExecutionLog[];
  toolError?: { tool: string; code: string; message: string };
  sessionContextUpdated?: boolean;
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
  memory?: boolean;
  withTools?: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
} {
  let provider: string | undefined;
  let profile: string | undefined;
  let sessionKey: string | undefined;
  let newSession = false;
  let memory: boolean | undefined;
  let withTools: boolean | undefined;
  let toolAllow: string[] | undefined;
  let toolMaxSteps: number | undefined;
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

    if (arg === "--memory" || arg === "--no-memory" || arg.startsWith("--memory=")) {
      memory = parseMemoryFlag(arg, i);
      continue;
    }

    if (arg === '--with-tools' || arg === '--no-with-tools' || arg.startsWith('--with-tools=')) {
      withTools = parseBooleanFlag(arg, i);
      continue;
    }

    if (arg === '--tool-allow') {
      throwIfMissingValue('tool-allow', i + 1, argv);
      toolAllow = parseCsvOption(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg.startsWith('--tool-allow=')) {
      toolAllow = parseCsvOption(arg.slice('--tool-allow='.length));
      continue;
    }

    if (arg === '--tool-max-steps') {
      throwIfMissingValue('tool-max-steps', i + 1, argv);
      toolMaxSteps = parsePositiveIntValue(argv[i + 1], i + 1, '--tool-max-steps');
      i += 1;
      continue;
    }

    if (arg.startsWith('--tool-max-steps=')) {
      toolMaxSteps = parsePositiveIntValue(arg.slice('--tool-max-steps='.length), i + 1, '--tool-max-steps');
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

  return { input: inputParts.join(" "), provider, profile, sessionKey, newSession, memory, withTools, toolAllow, toolMaxSteps };
}

function parseFeishuServerArgs(argv: string[]): {
  appId?: string;
  appSecret?: string;
  requestTimeoutMs?: number;
} {
  let appId: string | undefined;
  let appSecret: string | undefined;
  let requestTimeoutMs: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--app-id') {
      throwIfMissingValue('app-id', i + 1, argv);
      appId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--app-id=')) {
      appId = arg.slice('--app-id='.length);
      continue;
    }
    if (arg === '--app-secret') {
      throwIfMissingValue('app-secret', i + 1, argv);
      appSecret = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--app-secret=')) {
      appSecret = arg.slice('--app-secret='.length);
      continue;
    }
    if (arg === '--request-timeout-ms') {
      throwIfMissingValue('request-timeout-ms', i + 1, argv);
      requestTimeoutMs = parsePositiveIntValue(argv[i + 1], i + 1, '--request-timeout-ms');
      i += 1;
      continue;
    }
    if (arg.startsWith('--request-timeout-ms=')) {
      requestTimeoutMs = parsePositiveIntValue(arg.slice('--request-timeout-ms='.length), i + 1, '--request-timeout-ms');
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    appId,
    appSecret,
    requestTimeoutMs,
  };
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

async function runToolsCommand(argv: string[]): Promise<number> {
  const [, ...rest] = argv;
  const subcommand = rest[0];
  const args = rest.slice(1);

  if (!subcommand) {
    console.error('Usage: lainclaw tools <list|info|invoke>');
    return 1;
  }

  if (subcommand === 'list') {
    console.log(JSON.stringify(listToolsCatalog(), null, 2));
    return 0;
  }

  if (subcommand === 'info') {
    const name = args[0];
    if (!name) {
      console.error('Usage: lainclaw tools info <name>');
      return 1;
    }

    const tool = getToolInfo(name);
    if (!tool) {
      console.error(`Tool not found: ${name}`);
      return 1;
    }

    console.log(JSON.stringify(tool, null, 2));
    return 0;
  }

  if (subcommand === 'invoke') {
    const targetName = args[0];
    if (!targetName) {
      console.error('Usage: lainclaw tools invoke <name> --args <json>');
      return 1;
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
        console.error(`Unknown option: ${arg}`);
        return 1;
      }
    }

    let parsedArgs: unknown = {};
    try {
      if (typeof rawArgs === 'string' && rawArgs.length > 0) {
        parsedArgs = JSON.parse(rawArgs);
      }
    } catch (error) {
      console.error(`Invalid --args json: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }

    const execResult = await invokeToolByCli(targetName, parsedArgs, {
      requestId: `cli-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, '0')}`,
      sessionId: 'tools-cli',
      sessionKey: 'tools',
      cwd: process.cwd(),
    });

    console.log(JSON.stringify(execResult, null, 2));
    return execResult.result.ok ? 0 : 1;
  }

  console.error(`Unknown tools subcommand: ${subcommand}`);
  console.error('Usage: lainclaw tools <list|info|invoke>');
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
      const { input, provider, profile, sessionKey, newSession, memory, withTools, toolAllow, toolMaxSteps } = parseAskArgs(
        argv.slice(1),
      );
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
        ...(typeof memory === 'boolean' ? { memory } : {}),
        ...(typeof withTools === 'boolean' ? { withTools } : {}),
        ...(toolAllow ? { toolAllow } : {}),
        ...(typeof toolMaxSteps === 'number' ? { toolMaxSteps } : {}),
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

  if (command === 'tools') {
    try {
      return await runToolsCommand(argv);
    } catch (error) {
      console.error("ERROR:", String(error instanceof Error ? error.message : error));
      return 1;
    }
  }

  if (command === 'feishu') {
    try {
      const options = parseFeishuServerArgs(argv.slice(1));
      await runFeishuGatewayServer(options);
      return 0;
    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(`[${error.code}] ${error.message}`);
      } else {
        console.error("ERROR:", String(error instanceof Error ? error.message : error));
      }
      console.error('Usage: lainclaw feishu [--app-id <id>] [--app-secret <secret>] [--request-timeout-ms <ms>]');
      return 1;
    }
  }

  console.error(`Unknown command: ${command}`);
  return 1;
}
