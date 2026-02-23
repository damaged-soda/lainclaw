import { ValidationError } from '../shared/types.js';
import { runAsk } from '../gateway/askGateway.js';
import { runHeartbeatOnce, startHeartbeatLoop } from '../heartbeat/runner.js';
import type { HeartbeatRunSummary } from '../heartbeat/runner.js';
import {
  addHeartbeatRule,
  listHeartbeatRules,
  removeHeartbeatRule,
  setHeartbeatRuleEnabled,
} from '../heartbeat/store.js';
import { runFeishuGatewayServer } from '../channels/feishu/server.js';
import { runLocalGatewayServer, type LocalGatewayOverrides } from '../channels/local/server.js';
import { sendFeishuTextMessage } from '../channels/feishu/outbound.js';
import { runPairingCommand } from '../pairing/cli.js';
import {
  clearFeishuGatewayConfig,
  loadCachedFeishuGatewayConfig,
  persistFeishuGatewayConfig,
  resolveFeishuGatewayConfigPath,
  resolveFeishuGatewayConfig,
  type FeishuGatewayConfig,
} from '../channels/feishu/config.js';
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
import {
  clearGatewayServiceState,
  isProcessAlive,
  readGatewayServiceState,
  writeGatewayServiceState,
  resolveGatewayServicePaths,
  spawnGatewayServiceProcess,
  terminateGatewayProcess,
  type GatewayServicePaths,
  type GatewayServiceState,
} from '../gateway/service.js';

const VERSION = '0.1.0';

function normalizePairingPolicy(
  raw: string | undefined,
): FeishuGatewayConfig["pairingPolicy"] {
  const normalized = raw?.trim().toLowerCase();
  if (
    normalized === "open"
    || normalized === "allowlist"
    || normalized === "pairing"
    || normalized === "disabled"
  ) {
    return normalized;
  }
  return undefined;
}

export function printUsage(): string {
  return [
    'Usage:',
    '  lainclaw --help',
    '  lainclaw --version',
    '  lainclaw ask <input>',
    '  lainclaw ask [--provider <provider>] [--profile <profile>] [--session <name>] [--new-session] [--memory|--no-memory|--memory=on|off] [--with-tools|--no-with-tools|--with-tools=true|false] [--tool-allow <tool1,tool2>] [--tool-max-steps <N>] <input>',
    '  lainclaw gateway start [--channel <feishu|local>] [--provider <provider>] [--profile <profile>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--tool-max-steps <N>] [--memory|--no-memory] [--heartbeat-enabled|--no-heartbeat-enabled] [--heartbeat-interval-ms <ms>] [--heartbeat-target-open-id <openId>] [--heartbeat-session-key <key>] [--pairing-policy <open|allowlist|pairing|disabled>] [--pairing-allow-from <id1,id2>] [--pairing-pending-ttl-ms <ms>] [--pairing-pending-max <n>] [--app-id <id>] [--app-secret <secret>] [--request-timeout-ms <ms>] [--daemon] [--pid-file <path>] [--log-file <path>]',
  '  lainclaw gateway status [--channel <channel>] [--pid-file <path>] [--log-file <path>]',
  '  lainclaw gateway stop [--channel <channel>] [--pid-file <path>]',
    '  lainclaw gateway config set [--channel <channel>] [--provider <provider>] [--profile <profile>] [--app-id <id>] [--app-secret <secret>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--tool-max-steps <N>] [--memory|--no-memory] [--heartbeat-enabled|--no-heartbeat-enabled] [--heartbeat-interval-ms <ms>] [--heartbeat-target-open-id <openId>] [--heartbeat-session-key <key>] [--pairing-policy <open|allowlist|pairing|disabled>] [--pairing-allow-from <id1,id2>] [--pairing-pending-ttl-ms <ms>] [--pairing-pending-max <n>] [--request-timeout-ms <ms>]',
    '  lainclaw gateway config show [--channel <channel>]',
    '  lainclaw gateway config clear [--channel <channel>]',
    '  lainclaw pairing list [--channel <channel>] [--account <accountId>] [--json]',
    '  lainclaw pairing approve [--channel <channel>] [--account <accountId>] <code>',
    '  lainclaw pairing revoke [--channel <channel>] [--account <accountId>] <entry>',
    '  lainclaw tools list',
    '  lainclaw tools info <name>',
    '  lainclaw tools invoke <name> --args <json>',
    '  lainclaw heartbeat add "<ruleText>" [--provider <provider>] [--profile <profile>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--tool-max-steps <N>]',
    '  lainclaw heartbeat list',
    '  lainclaw heartbeat remove <ruleId>',
    '  lainclaw heartbeat enable <ruleId>',
    '  lainclaw heartbeat disable <ruleId>',
    '  lainclaw heartbeat run [--provider <provider>] [--profile <profile>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--tool-max-steps <N>] [--memory|--no-memory]',
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
    'Notes: model defaults to openai-codex when `provider` is set; other providers still return stub result.'
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

function parseBooleanFlag(raw: string, index: number, name: 'with-tools' | 'heartbeat-enabled' = 'with-tools'): boolean {
  const normalizedName = name;
  const enabled = `--${normalizedName}`;
  const disabled = `--no-${normalizedName}`;
  if (raw === enabled) {
    return true;
  }

  if (raw === disabled) {
    return false;
  }

  if (raw.startsWith(`${enabled}=`)) {
    const value = raw.slice(`${enabled}=`.length).toLowerCase();
    if (value === 'on' || value === 'true' || value === '1') {
      return true;
    }
    if (value === 'off' || value === 'false' || value === '0') {
      return false;
    }
    throw new Error(`Invalid value for ${enabled} at arg ${index + 1}: ${value}`);
  }

  throw new Error(`Invalid boolean flag: ${raw}`);
}

function isAuthError(rawMessage: string): boolean {
  return (
    rawMessage.includes("No openai-codex profile found") ||
    rawMessage.includes("No openai-codex profile found. Run: lainclaw auth login openai-codex") ||
    rawMessage.includes("Failed to read OAuth credentials for openai-codex")
  );
}

function isProviderNotSupportedError(rawMessage: string): boolean {
  return rawMessage.includes("Unsupported provider");
}

interface HeartbeatTargetDiagnostic {
  kind: "open-user-id" | "chat-id" | "legacy-user-id" | "unknown";
  warning?: string;
}

function inspectHeartbeatTargetOpenId(raw: string): HeartbeatTargetDiagnostic {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      kind: "unknown",
      warning: "heartbeat target open id is empty, heartbeat is effectively disabled",
    };
  }

  if (trimmed.startsWith("ou_") || trimmed.startsWith("on_")) {
    return {
      kind: "open-user-id",
    };
  }

  if (trimmed.startsWith("oc_")) {
    return {
      kind: "chat-id",
      warning: "检测到 oc_ 前缀，通常为会话ID/群ID；当前会尝试按会话消息发送，若期望私聊提醒请改为用户 open_id（ou_/on_）。",
    };
  }

  if (trimmed.startsWith("u_") || trimmed.startsWith("user_")) {
    return {
      kind: "legacy-user-id",
      warning: "检测到疑似旧 user_id，飞书发送可能需要换用 open_id（ou_/on_）；系统会继续尝试兜底发送。",
    };
  }

  return {
    kind: "unknown",
    warning: "heartbeat target open id 前缀不在已识别范围内（ou_/on_/oc_）。系统会继续尝试发送，但建议你确认是否为有效接收人 open_id。",
  };
}

function maskCredential(value: string | undefined): string {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return "<empty>";
  }
  if (trimmed.length <= 6) {
    return "*".repeat(trimmed.length);
  }
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-3)}`;
}

function isPlaceholderLikely(raw: string | undefined): boolean {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed.length < 6) {
    return true;
  }
  if (/^\d+$/.test(trimmed)) {
    return true;
  }
  if (/^(test|demo|fake|dummy|sample|example|placeholder|abc|aaa|xxx)+$/i.test(trimmed)) {
    return true;
  }
  return false;
}

function validateFeishuGatewayCredentials(config: { appId?: string; appSecret?: string }): void {
  const configPath = resolveFeishuGatewayConfigPath("feishu");
  if (!config.appId || !config.appSecret) {
    throw new Error(
      "Missing FEISHU_APP_ID or FEISHU_APP_SECRET for websocket mode. "
      + "请执行 `lainclaw gateway start --app-id <真实AppID> --app-secret <真实AppSecret>` "
      + `或清理当前频道网关缓存后重试：` + "`rm " + `${configPath}` + "`。",
    );
  }

  if (isPlaceholderLikely(config.appId) || isPlaceholderLikely(config.appSecret)) {
    throw new Error(
      `Detected invalid/placeholder Feishu credentials (appId=${maskCredential(config.appId)}, `
      + `appSecret=${maskCredential(config.appSecret)}). `
      + "请确认使用真实飞书应用凭据，再清理当前频道网关缓存并重启 gateway。"
      + `（路径：${configPath}）`,
    );
  }
}

function makeFeishuFailureHint(rawMessage: string): string {
  if (rawMessage.includes("ask timeout")) {
    return "模型处理超时，请稍后重试；若持续超时请检查网络或加长 timeout 配置。";
  }
  if (isAuthError(rawMessage)) {
    return "未检测到可用 openai-codex 登录，请先执行：`lainclaw auth login openai-codex`。";
  }
  if (isProviderNotSupportedError(rawMessage)) {
    return "当前仅支持 provider=openai-codex，请使用 `--provider openai-codex`。";
  }
  return "模型调用失败，请联系管理员查看服务日志；或使用 `--provider openai-codex --profile <profileId>` 重试。";
}

function formatHeartbeatErrorHint(rawMessage: string): string {
  if (rawMessage.includes("contact:user.employee_id:readonly")) {
    return `${rawMessage}。请在飞书应用后台为应用补充 “联系人-查看员工个人资料-只读（contact:user.employee_id:readonly）” 权限，并重装应用后重试。`;
  }
  if (rawMessage.includes("not a valid") && rawMessage.includes("Invalid ids: [oc_")) {
    return `${rawMessage}。检测到目标 ID 为 oc_ 前缀，通常需要传入用户 open_id（ou_）或可用的 user_id；请确认你配置的是接收人个人 open_id。`;
  }
  return rawMessage;
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

interface HeartbeatCommandOptions {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
  memory?: boolean;
  positional: string[];
}

function parseHeartbeatModelArgs(argv: string[], allowMemory = false): HeartbeatCommandOptions {
  let provider: string | undefined;
  let profileId: string | undefined;
  let withTools: boolean | undefined;
  let toolAllow: string[] | undefined;
  let toolMaxSteps: number | undefined;
  let memory: boolean | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--provider") {
      throwIfMissingValue("provider", i + 1, argv);
      provider = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--provider=")) {
      provider = arg.slice("--provider=".length);
      continue;
    }
    if (arg === "--profile") {
      throwIfMissingValue("profile", i + 1, argv);
      profileId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--profile=")) {
      profileId = arg.slice("--profile=".length);
      continue;
    }

    if (arg === "--with-tools" || arg === "--no-with-tools" || arg.startsWith("--with-tools=")) {
      withTools = parseBooleanFlag(arg, i);
      continue;
    }

    if (arg === "--tool-allow") {
      throwIfMissingValue("tool-allow", i + 1, argv);
      toolAllow = parseCsvOption(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--tool-allow=")) {
      toolAllow = parseCsvOption(arg.slice("--tool-allow=".length));
      continue;
    }

    if (arg === "--tool-max-steps") {
      throwIfMissingValue("tool-max-steps", i + 1, argv);
      toolMaxSteps = parsePositiveIntValue(argv[i + 1], i + 1, "--tool-max-steps");
      i += 1;
      continue;
    }
    if (arg.startsWith("--tool-max-steps=")) {
      toolMaxSteps = parsePositiveIntValue(arg.slice("--tool-max-steps=".length), i + 1, "--tool-max-steps");
      continue;
    }

    if (allowMemory && (arg === "--memory" || arg === "--no-memory" || arg.startsWith("--memory="))) {
      memory = parseMemoryFlag(arg, i);
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positional.push(arg);
  }

  return {
    provider,
    profileId,
    withTools,
    ...(toolAllow ? { toolAllow } : {}),
    ...(typeof toolMaxSteps === "number" ? { toolMaxSteps } : {}),
    ...(typeof memory === "boolean" ? { memory } : {}),
    positional,
  };
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
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  memory?: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
  heartbeatEnabled?: boolean;
  heartbeatIntervalMs?: number;
  heartbeatTargetOpenId?: string;
  heartbeatSessionKey?: string;
  pairingPolicy?: FeishuGatewayConfig["pairingPolicy"];
  pairingPendingTtlMs?: number;
  pairingPendingMax?: number;
  pairingAllowFrom?: string[];
} {
  let appId: string | undefined;
  let appSecret: string | undefined;
  let requestTimeoutMs: number | undefined;
  let provider: string | undefined;
  let profileId: string | undefined;
  let withTools: boolean | undefined;
  let memory: boolean | undefined;
  let toolAllow: string[] | undefined;
  let toolMaxSteps: number | undefined;
  let heartbeatEnabled: boolean | undefined;
  let heartbeatIntervalMs: number | undefined;
  let heartbeatTargetOpenId: string | undefined;
  let heartbeatSessionKey: string | undefined;
  let pairingPolicy: string | undefined;
  let pairingPendingTtlMs: number | undefined;
  let pairingPendingMax: number | undefined;
  let pairingAllowFrom: string[] | undefined;

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

    if (arg === '--provider') {
      throwIfMissingValue('provider', i + 1, argv);
      provider = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--provider=')) {
      provider = arg.slice('--provider='.length);
      continue;
    }

    if (arg === '--profile') {
      throwIfMissingValue('profile', i + 1, argv);
      profileId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--profile=')) {
      profileId = arg.slice('--profile='.length);
      continue;
    }

    if (arg === '--with-tools' || arg === '--no-with-tools' || arg.startsWith('--with-tools=')) {
      withTools = parseBooleanFlag(arg, i);
      continue;
    }

    if (arg === '--memory' || arg === '--no-memory' || arg.startsWith('--memory=')) {
      memory = parseMemoryFlag(arg, i);
      continue;
    }

    if (arg === '--pairing-policy') {
      throwIfMissingValue('pairing-policy', i + 1, argv);
      pairingPolicy = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--pairing-policy=')) {
      pairingPolicy = arg.slice('--pairing-policy='.length);
      continue;
    }

    if (arg === '--pairing-pending-ttl-ms') {
      throwIfMissingValue('pairing-pending-ttl-ms', i + 1, argv);
      pairingPendingTtlMs = parsePositiveIntValue(argv[i + 1], i + 1, '--pairing-pending-ttl-ms');
      i += 1;
      continue;
    }
    if (arg.startsWith('--pairing-pending-ttl-ms=')) {
      pairingPendingTtlMs = parsePositiveIntValue(
        arg.slice('--pairing-pending-ttl-ms='.length),
        i + 1,
        '--pairing-pending-ttl-ms',
      );
      continue;
    }

    if (arg === '--pairing-pending-max') {
      throwIfMissingValue('pairing-pending-max', i + 1, argv);
      pairingPendingMax = parsePositiveIntValue(argv[i + 1], i + 1, '--pairing-pending-max');
      i += 1;
      continue;
    }
    if (arg.startsWith('--pairing-pending-max=')) {
      pairingPendingMax = parsePositiveIntValue(
        arg.slice('--pairing-pending-max='.length),
        i + 1,
        '--pairing-pending-max',
      );
      continue;
    }

    if (arg === '--pairing-allow-from') {
      throwIfMissingValue('pairing-allow-from', i + 1, argv);
      pairingAllowFrom = parseCsvOption(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--pairing-allow-from=')) {
      pairingAllowFrom = parseCsvOption(arg.slice('--pairing-allow-from='.length));
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

    if (arg === '--heartbeat-enabled' || arg === '--no-heartbeat-enabled' || arg.startsWith('--heartbeat-enabled=')) {
      heartbeatEnabled = parseBooleanFlag(arg, i, 'heartbeat-enabled');
      continue;
    }

    if (arg === '--heartbeat-interval-ms') {
      throwIfMissingValue('heartbeat-interval-ms', i + 1, argv);
      heartbeatIntervalMs = parsePositiveIntValue(argv[i + 1], i + 1, '--heartbeat-interval-ms');
      i += 1;
      continue;
    }
    if (arg.startsWith('--heartbeat-interval-ms=')) {
      heartbeatIntervalMs = parsePositiveIntValue(
        arg.slice('--heartbeat-interval-ms='.length),
        i + 1,
        '--heartbeat-interval-ms',
      );
      continue;
    }

    if (arg === '--heartbeat-target-open-id') {
      throwIfMissingValue('heartbeat-target-open-id', i + 1, argv);
      heartbeatTargetOpenId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--heartbeat-target-open-id=')) {
      heartbeatTargetOpenId = arg.slice('--heartbeat-target-open-id='.length);
      continue;
    }

    if (arg === '--heartbeat-session-key') {
      throwIfMissingValue('heartbeat-session-key', i + 1, argv);
      heartbeatSessionKey = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--heartbeat-session-key=')) {
      heartbeatSessionKey = arg.slice('--heartbeat-session-key='.length);
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (provider) {
    const normalizedProvider = provider.trim().toLowerCase();
    if (normalizedProvider.length > 0 && normalizedProvider !== "openai-codex") {
      throw new Error(`Unsupported feishu provider: ${provider}`);
    }
  }

  return {
    appId,
    appSecret,
    requestTimeoutMs,
    provider,
    profileId,
    withTools,
    memory,
    toolAllow,
    toolMaxSteps,
    heartbeatEnabled,
    heartbeatIntervalMs,
    heartbeatTargetOpenId: heartbeatTargetOpenId?.trim(),
    heartbeatSessionKey: heartbeatSessionKey?.trim(),
    pairingPolicy: normalizePairingPolicy(pairingPolicy),
    pairingPendingTtlMs,
    pairingPendingMax,
    pairingAllowFrom,
  };
}

function parseLocalGatewayArgs(argv: string[]): LocalGatewayOverrides {
  const parsed = parseHeartbeatModelArgs(argv, true);
  if (parsed.positional.length > 0) {
    throw new Error(`Unknown argument for gateway start: ${parsed.positional[0]}`);
  }

  if (parsed.provider && parsed.provider !== "openai-codex") {
    throw new Error(`Unsupported provider: ${parsed.provider}`);
  }

  return {
    ...(parsed.provider ? { provider: parsed.provider } : {}),
    ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
    ...(typeof parsed.withTools === "boolean" ? { withTools: parsed.withTools } : {}),
    ...(typeof parsed.memory === "boolean" ? { memory: parsed.memory } : {}),
    ...(parsed.toolAllow ? { toolAllow: parsed.toolAllow } : {}),
    ...(typeof parsed.toolMaxSteps === "number" ? { toolMaxSteps: parsed.toolMaxSteps } : {}),
  };
}

type GatewayChannel = "feishu" | "local";

function parseGatewayArgs(argv: string[]): {
  channel: GatewayChannel;
  action: "start" | "status" | "stop";
  appId?: string;
  appSecret?: string;
  requestTimeoutMs?: number;
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  memory?: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
  heartbeatEnabled?: boolean;
  heartbeatIntervalMs?: number;
  heartbeatTargetOpenId?: string;
  heartbeatSessionKey?: string;
  pairingPolicy?: FeishuGatewayConfig["pairingPolicy"];
  pairingPendingTtlMs?: number;
  pairingPendingMax?: number;
  pairingAllowFrom?: string[];
  daemon?: boolean;
  statePath?: string;
  logPath?: string;
  serviceChild?: boolean;
  serviceArgv: string[];
} {
  let channel: GatewayChannel = "feishu";
  let action: "start" | "status" | "stop" = "start";
  let daemon = false;
  let statePath: string | undefined;
  let logPath: string | undefined;
  let serviceChild = false;
  const channelAwareArgs: string[] = [];
  const serviceArgv: string[] = [];
  let actionParsed = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (!actionParsed && !arg.startsWith("--")) {
      if (arg === "start" || arg === "status" || arg === "stop") {
        action = arg;
        actionParsed = true;
        continue;
      }
      throw new Error(`Unknown gateway subcommand: ${arg}`);
    }

    if (arg === '--daemon') {
      if (action !== "start") {
        throw new Error(`--daemon is only valid for: lainclaw gateway start ...`);
      }
      daemon = true;
      continue;
    }

    if (arg === '--service-child') {
      serviceChild = true;
      continue;
    }

    if (arg === '--pid-file') {
      throwIfMissingValue('pid-file', i + 1, argv);
      statePath = argv[i + 1];
      serviceArgv.push(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--pid-file=')) {
      statePath = arg.slice('--pid-file='.length);
      if (!statePath) {
        throw new Error('Invalid value for --pid-file');
      }
      serviceArgv.push(arg);
      continue;
    }

    if (arg === '--log-file') {
      throwIfMissingValue('log-file', i + 1, argv);
      logPath = argv[i + 1];
      serviceArgv.push(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--log-file=')) {
      logPath = arg.slice('--log-file='.length);
      if (!logPath) {
        throw new Error('Invalid value for --log-file');
      }
      serviceArgv.push(arg);
      continue;
    }

    if (arg === '--channel') {
      throwIfMissingValue('channel', i + 1, argv);
      const next = argv[i + 1].trim().toLowerCase();
      if (next !== "feishu" && next !== "local") {
        throw new Error(`Unsupported channel: ${argv[i + 1]}`);
      }
      channel = next;
      serviceArgv.push(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--channel=')) {
      const next = arg.slice('--channel='.length).trim().toLowerCase();
      if (next !== "feishu" && next !== "local") {
        throw new Error(`Unsupported channel: ${arg.slice('--channel='.length)}`);
      }
      channel = next;
      serviceArgv.push(arg);
      continue;
    }

    if (arg.startsWith('--')) {
      const isConfigOption = action === "start";
      if (!isConfigOption) {
        throw new Error(`Unknown option for gateway ${action}: ${arg}`);
      }
      if (!arg.includes("=") && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        channelAwareArgs.push(arg, argv[i + 1]);
        serviceArgv.push(arg, argv[i + 1]);
        i += 1;
        continue;
      }
      channelAwareArgs.push(arg);
      serviceArgv.push(arg);
      continue;
    }

    throw new Error(`Unknown argument for gateway ${action}: ${arg}`);
  }

  if (action === "start") {
    if (channel === "local") {
      const localConfig = parseLocalGatewayArgs(channelAwareArgs);
      return {
        channel,
        action,
        ...localConfig,
        daemon,
        statePath,
        logPath,
        serviceChild,
        serviceArgv,
      };
    }

    const feishuConfig = parseFeishuServerArgs(channelAwareArgs);
    return {
      channel,
      action,
      ...feishuConfig,
      daemon,
      statePath,
      logPath,
      serviceChild,
      serviceArgv,
    };
  }

  return {
    channel,
    action,
    daemon: false,
    statePath,
    logPath,
    serviceChild,
    serviceArgv,
  };
}

function parseGatewayConfigArgs(argv: string[]): {
  channel: string;
  action: "set" | "show" | "clear";
  config: Partial<FeishuGatewayConfig>;
} {
  const subcommand = argv[0];
  if (!subcommand) {
    throw new Error("Missing gateway config subcommand");
  }
  let channel = "feishu";
  const configArgv: string[] = [];

  if (subcommand === "set") {
    for (let i = 1; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === "--channel") {
        if (i + 1 >= argv.length) {
          throw new Error("Invalid value for --channel");
        }
        channel = argv[i + 1].trim().toLowerCase();
        i += 1;
        continue;
      }
      if (arg.startsWith("--channel=")) {
        channel = arg.slice("--channel=".length).trim().toLowerCase();
        if (!channel) {
          throw new Error("Invalid value for --channel");
        }
        continue;
      }
      if (arg.startsWith("--")) {
        configArgv.push(arg);
        continue;
      }
      configArgv.push(arg);
    }

    const config = parseFeishuServerArgs(configArgv);
    return { channel, action: "set", config };
  }

  if (subcommand === "show" || subcommand === "clear") {
    for (let i = 1; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === "--channel") {
        if (i + 1 >= argv.length) {
          throw new Error("Invalid value for --channel");
        }
        channel = argv[i + 1].trim().toLowerCase();
        i += 1;
        continue;
      }
      if (arg.startsWith("--channel=")) {
        channel = arg.slice("--channel=".length).trim().toLowerCase();
        if (!channel) {
          throw new Error("Invalid value for --channel");
        }
        continue;
      }
      if (arg.startsWith("--")) {
        throw new Error(`Unknown option for gateway config ${subcommand}: ${arg}`);
      }
      throw new Error(`Unexpected argument for gateway config ${subcommand}: ${arg}`);
    }
    return { channel, action: subcommand, config: {} };
  }

  throw new Error(`Unknown gateway config subcommand: ${subcommand}`);
}

function maskConfigValue(raw: string | undefined): string | undefined {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= 6) {
    return "*".repeat(trimmed.length);
  }
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-3)}`;
}

async function runGatewayConfigCommand(argv: string[]): Promise<void> {
  const parsed = parseGatewayConfigArgs(argv);

  if (parsed.action === "set") {
    if (Object.keys(parsed.config).length === 0) {
      throw new Error("No gateway config fields provided");
    }
    await persistFeishuGatewayConfig(parsed.config, parsed.channel);
    console.log("gateway config updated");
    return;
  }

  if (parsed.action === "clear") {
    await clearFeishuGatewayConfig(parsed.channel);
    console.log("gateway config cleared");
    return;
  }

  const cached = await loadCachedFeishuGatewayConfig(parsed.channel);
  const configPath = resolveFeishuGatewayConfigPath(parsed.channel);
  const masked = {
    channel: parsed.channel,
    configPath,
    ...cached,
    ...(cached.appId ? { appId: maskConfigValue(cached.appId) } : {}),
    ...(cached.appSecret ? { appSecret: maskConfigValue(cached.appSecret) } : {}),
  };
  console.log(JSON.stringify(masked, null, 2));
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

function parseHeartbeatAddArgs(argv: string[]): {
  ruleText: string;
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
} {
  const parsed = parseHeartbeatModelArgs(argv, false);
  const ruleText = parsed.positional.join(" ").trim();
  if (!ruleText) {
    throw new Error("Missing rule text.");
  }
  return {
    ruleText,
    ...(parsed.provider ? { provider: parsed.provider } : {}),
    ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
    ...(typeof parsed.withTools === 'boolean' ? { withTools: parsed.withTools } : {}),
    ...(parsed.toolAllow ? { toolAllow: parsed.toolAllow } : {}),
    ...(typeof parsed.toolMaxSteps === 'number' ? { toolMaxSteps: parsed.toolMaxSteps } : {}),
  };
}

function parseHeartbeatRunArgs(argv: string[]): {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
  memory?: boolean;
} {
  const parsed = parseHeartbeatModelArgs(argv, true);
  if (parsed.positional.length > 0) {
    throw new Error(`Unknown argument for heartbeat run: ${parsed.positional[0]}`);
  }
  return {
    ...(parsed.provider ? { provider: parsed.provider } : {}),
    ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
    ...(typeof parsed.withTools === 'boolean' ? { withTools: parsed.withTools } : {}),
    ...(parsed.toolAllow ? { toolAllow: parsed.toolAllow } : {}),
    ...(typeof parsed.toolMaxSteps === 'number' ? { toolMaxSteps: parsed.toolMaxSteps } : {}),
    ...(typeof parsed.memory === 'boolean' ? { memory: parsed.memory } : {}),
  };
}

async function runHeartbeatCommand(argv: string[]): Promise<number> {
  const [, subcommand, ...rest] = argv;

  if (!subcommand) {
    console.error("Usage: lainclaw heartbeat <add|list|remove|enable|disable|run>");
    return 1;
  }

  if (subcommand === "add") {
    const parsed = parseHeartbeatAddArgs(rest);
    if (parsed.provider && parsed.provider !== "openai-codex") {
      throw new Error(`Unsupported provider: ${parsed.provider}`);
    }
    const rule = await addHeartbeatRule({
      ruleText: parsed.ruleText,
      ...(parsed.provider ? { provider: parsed.provider } : {}),
      ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
      ...(parsed.toolAllow ? { toolAllow: parsed.toolAllow } : {}),
      ...(typeof parsed.withTools === 'boolean' ? { withTools: parsed.withTools } : {}),
      ...(typeof parsed.toolMaxSteps === 'number' ? { toolMaxSteps: parsed.toolMaxSteps } : {}),
    });
    console.log(`Added heartbeat rule: ${rule.id}`);
    console.log(JSON.stringify(rule, null, 2));
    return 0;
  }

  if (subcommand === "list") {
    const rules = await listHeartbeatRules();
    console.log(JSON.stringify(rules, null, 2));
    return 0;
  }

  if (subcommand === "remove") {
    const ruleId = rest[0];
    if (!ruleId) {
      console.error("Usage: lainclaw heartbeat remove <ruleId>");
      return 1;
    }
    const removed = await removeHeartbeatRule(ruleId);
    if (!removed) {
      console.error(`Heartbeat rule not found: ${ruleId}`);
      return 1;
    }
    console.log(`Removed heartbeat rule: ${ruleId}`);
    return 0;
  }

  if (subcommand === "enable" || subcommand === "disable") {
    const ruleId = rest[0];
    if (!ruleId) {
      console.error(`Usage: lainclaw heartbeat ${subcommand} <ruleId>`);
      return 1;
    }
    const enabled = subcommand === "enable";
    const updated = await setHeartbeatRuleEnabled(ruleId, enabled);
    if (!updated) {
      console.error(`Heartbeat rule not found: ${ruleId}`);
      return 1;
    }
    console.log(`Updated heartbeat rule ${ruleId}: ${enabled ? "enabled" : "disabled"}`);
    return 0;
  }

  if (subcommand === "run") {
    const parsed = parseHeartbeatRunArgs(rest);
    if (parsed.provider && parsed.provider !== "openai-codex") {
      throw new Error(`Unsupported provider: ${parsed.provider}`);
    }
    const summary = await runHeartbeatOnce({
      ...(parsed.provider ? { provider: parsed.provider } : {}),
      ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
      ...(typeof parsed.withTools === 'boolean' ? { withTools: parsed.withTools } : {}),
      ...(parsed.toolAllow ? { toolAllow: parsed.toolAllow } : {}),
      ...(typeof parsed.toolMaxSteps === 'number' ? { toolMaxSteps: parsed.toolMaxSteps } : {}),
      ...(typeof parsed.memory === 'boolean' ? { memory: parsed.memory } : {}),
    });
    console.log(JSON.stringify(summary, null, 2));
    return summary.errors > 0 ? 1 : 0;
  }

  console.error(`Unknown heartbeat subcommand: ${subcommand}`);
  console.error('Usage: lainclaw heartbeat <add|list|remove|enable|disable|run>');
  return 1;
}

function formatHeartbeatSummary(summary: HeartbeatRunSummary): string {
  return `[heartbeat] ranAt=${summary.ranAt} total=${summary.total} evaluated=${summary.evaluated} triggered=${summary.triggered} skipped=${summary.skipped} errors=${summary.errors}`;
}

function buildHeartbeatMessage(ruleText: string, triggerMessage: string): string {
  const body = triggerMessage.trim() || "已触发";
  const lines = ["【Lainclaw 心跳提醒】", `规则：${ruleText}`, `内容：${body}`];
  return lines.join("\n");
}

interface GatewayServiceRunContext {
  channel: GatewayChannel;
  action?: "start" | "status" | "stop";
  daemon?: boolean;
  statePath?: string;
  logPath?: string;
  serviceChild?: boolean;
  serviceArgv: string[];
}

async function stopGatewayServiceIfRunning(paths: GatewayServicePaths, state: GatewayServiceState): Promise<void> {
  const stopped = await terminateGatewayProcess(state.pid);
  if (!stopped) {
    throw new Error(`Failed to stop gateway process (pid=${state.pid})`);
  }
  await clearGatewayServiceState(paths.statePath);
}

async function resolveGatewayServiceState(
  paths: GatewayServicePaths,
): Promise<{ state: GatewayServiceState | null; running: boolean; stale: boolean }> {
  const state = await readGatewayServiceState(paths.statePath);
  if (!state) {
    return { state: null, running: false, stale: false };
  }

  const alive = isProcessAlive(state.pid);
  if (!alive) {
    await clearGatewayServiceState(paths.statePath);
    return { state, running: false, stale: true };
  }

  return { state, running: true, stale: false };
}

async function printGatewayServiceStatus(
  paths: GatewayServicePaths,
  channel = "feishu",
): Promise<void> {
  const snapshot = await resolveGatewayServiceState(paths);
  if (!snapshot.state) {
    console.log(
      JSON.stringify(
        {
          status: "stopped",
          running: false,
          pid: null,
          channel,
          statePath: paths.statePath,
          logPath: paths.logPath,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    JSON.stringify(
      {
        status: snapshot.running ? "running" : "stopped",
        running: snapshot.running,
        channel: snapshot.state.channel,
        pid: snapshot.state.pid,
        startedAt: snapshot.state.startedAt,
        statePath: snapshot.state.statePath,
        logPath: snapshot.state.logPath,
        command: snapshot.state.command,
        argv: snapshot.state.argv,
      },
      null,
      2,
    ),
  );
}

async function runFeishuGatewayWithHeartbeat(
  overrides: Partial<FeishuGatewayConfig>,
  onFailureHint: (rawMessage: string) => string,
  serviceContext: GatewayServiceRunContext = {
    channel: "feishu",
    serviceArgv: [],
  },
): Promise<void> {
  if (serviceContext.serviceChild) {
    const config = await resolveFeishuGatewayConfig(overrides, serviceContext.channel);
    validateFeishuGatewayCredentials(config);
    if (config.heartbeatEnabled && !config.heartbeatTargetOpenId) {
      throw new Error("Missing value for heartbeat-target-open-id");
    }
    if (config.heartbeatEnabled && config.heartbeatTargetOpenId) {
      const targetDiagnostic = inspectHeartbeatTargetOpenId(config.heartbeatTargetOpenId);
      if (typeof targetDiagnostic.warning === "string" && targetDiagnostic.warning.length > 0) {
        if (targetDiagnostic.kind === "unknown") {
          console.warn(`[heartbeat] ${targetDiagnostic.warning}`);
        } else {
          console.info(`[heartbeat] ${targetDiagnostic.warning}`);
        }
      }
    }

    const heartbeatHandle =
      config.heartbeatEnabled
        ? startHeartbeatLoop(config.heartbeatIntervalMs, {
            provider: config.provider,
            ...(typeof config.profileId === "string" && config.profileId.trim() ? { profileId: config.profileId.trim() } : {}),
            withTools: config.withTools,
            ...(Array.isArray(config.toolAllow) ? { toolAllow: config.toolAllow } : {}),
            ...(typeof config.toolMaxSteps === "number" ? { toolMaxSteps: config.toolMaxSteps } : {}),
            memory: config.memory,
            sessionKey: config.heartbeatSessionKey,
            onSummary: (summary) => {
              console.log(formatHeartbeatSummary(summary));
            },
            onResult: (result) => {
              if (result.status === "triggered") {
                console.log(
                  `[heartbeat] rule=${result.ruleId} triggered message=${result.message || "(no message)"}`,
                );
                return;
              }
              if (result.status === "skipped") {
                console.log(
                  `[heartbeat] rule=${result.ruleId} skipped reason=${result.reason || result.message || "disabled/condition not met"}`,
                );
                return;
              }
              console.error(
                `[heartbeat] rule=${result.ruleId} errored reason=${formatHeartbeatErrorHint(
                  result.reason || result.decisionRaw || "unknown error",
                )}`,
              );
            },
            send: async ({ rule, triggerMessage }) => {
              if (!config.heartbeatTargetOpenId) {
                throw new Error("heartbeat is enabled but heartbeatTargetOpenId is not configured");
              }
              await sendFeishuTextMessage(config, {
                openId: config.heartbeatTargetOpenId,
                text: buildHeartbeatMessage(rule.ruleText, triggerMessage),
              });
            },
          })
        : undefined;

    if (heartbeatHandle) {
      heartbeatHandle
        .runOnce()
        .then((summary) => {
          console.log(
            `[heartbeat] startup runAt=${summary.ranAt} triggered=${summary.triggered} skipped=${summary.skipped} errors=${summary.errors}`,
          );
          if (summary.errors > 0) {
            for (const result of summary.results) {
              if (result.status === "errored") {
                console.error(
                  `[heartbeat] startup rule=${result.ruleId} error=${formatHeartbeatErrorHint(
                    result.reason || result.decisionRaw || "unknown error",
                  )}`,
                );
              }
            }
          }
        })
        .catch((error) => {
          console.error(`[heartbeat] startup run failed: ${String(error instanceof Error ? error.message : error)}`);
        });
    }

    try {
      await runFeishuGatewayServer(overrides, {
        onFailureHint,
      }, serviceContext.channel);
    } finally {
      heartbeatHandle?.stop();
    }
    return;
  }

  const paths = resolveGatewayServicePaths(serviceContext.channel, {
    statePath: serviceContext.statePath,
    logPath: serviceContext.logPath,
  });

  if (serviceContext.action === "status") {
    await printGatewayServiceStatus(paths, serviceContext.channel);
    return;
  }

  if (serviceContext.action === "stop") {
    const snapshot = await resolveGatewayServiceState(paths);
    if (!snapshot.state || !snapshot.running) {
      console.log("gateway service already stopped");
      if (snapshot.state) {
        await clearGatewayServiceState(paths.statePath);
      }
      return;
    }
    await stopGatewayServiceIfRunning(paths, snapshot.state);
    console.log(`gateway service stopped (pid=${snapshot.state.pid})`);
    return;
  }

  if (serviceContext.daemon) {
    const preflightConfig = await resolveFeishuGatewayConfig(overrides, serviceContext.channel);
    validateFeishuGatewayCredentials(preflightConfig);
    if (preflightConfig.heartbeatEnabled && !preflightConfig.heartbeatTargetOpenId) {
      throw new Error("Missing value for heartbeat-target-open-id");
    }
    if (preflightConfig.heartbeatEnabled && preflightConfig.heartbeatTargetOpenId) {
      const targetDiagnostic = inspectHeartbeatTargetOpenId(preflightConfig.heartbeatTargetOpenId);
      if (typeof targetDiagnostic.warning === "string" && targetDiagnostic.warning.length > 0) {
        if (targetDiagnostic.kind === "unknown") {
          console.warn(`[heartbeat] ${targetDiagnostic.warning}`);
        } else {
          console.info(`[heartbeat] ${targetDiagnostic.warning}`);
        }
      }
    }

    const snapshot = await resolveGatewayServiceState(paths);
    if (snapshot.running) {
      throw new Error(`Gateway already running (pid=${snapshot.state?.pid})`);
    }

    const daemonArgv = ["gateway", "start", ...serviceContext.serviceArgv, "--service-child"];
    const scriptPath = process.argv[1];
    if (!scriptPath) {
      throw new Error("Cannot locate service entrypoint");
    }

    const daemonPid = await spawnGatewayServiceProcess(scriptPath, daemonArgv, paths);
    const daemonState: GatewayServiceState = {
      channel: serviceContext.channel,
      pid: daemonPid,
      startedAt: new Date().toISOString(),
      command: `${process.execPath} ${scriptPath} ${daemonArgv.join(" ")}`.trim(),
      statePath: paths.statePath,
      logPath: paths.logPath,
      argv: [scriptPath, ...daemonArgv],
    };
    await writeGatewayServiceState(daemonState);
    console.log(`gateway service started as daemon: pid=${daemonPid}`);
    console.log(`status: ${paths.statePath}`);
    console.log(`log: ${paths.logPath}`);
    return;
  }

  const config = await resolveFeishuGatewayConfig(overrides, serviceContext.channel);
  validateFeishuGatewayCredentials(config);
  if (config.heartbeatEnabled && !config.heartbeatTargetOpenId) {
    throw new Error("Missing value for heartbeat-target-open-id");
  }
  if (config.heartbeatEnabled && config.heartbeatTargetOpenId) {
    const targetDiagnostic = inspectHeartbeatTargetOpenId(config.heartbeatTargetOpenId);
    if (typeof targetDiagnostic.warning === "string" && targetDiagnostic.warning.length > 0) {
      if (targetDiagnostic.kind === "unknown") {
        console.warn(`[heartbeat] ${targetDiagnostic.warning}`);
      } else {
        console.info(`[heartbeat] ${targetDiagnostic.warning}`);
      }
    }
  }

  const heartbeatHandle =
    config.heartbeatEnabled
      ? startHeartbeatLoop(config.heartbeatIntervalMs, {
          provider: config.provider,
          ...(typeof config.profileId === "string" && config.profileId.trim() ? { profileId: config.profileId.trim() } : {}),
          withTools: config.withTools,
          ...(Array.isArray(config.toolAllow) ? { toolAllow: config.toolAllow } : {}),
          ...(typeof config.toolMaxSteps === "number" ? { toolMaxSteps: config.toolMaxSteps } : {}),
          memory: config.memory,
          sessionKey: config.heartbeatSessionKey,
          onSummary: (summary) => {
            console.log(formatHeartbeatSummary(summary));
          },
          onResult: (result) => {
            if (result.status === "triggered") {
              console.log(
                `[heartbeat] rule=${result.ruleId} triggered message=${result.message || "(no message)"}`,
              );
              return;
            }
            if (result.status === "skipped") {
              console.log(
                `[heartbeat] rule=${result.ruleId} skipped reason=${result.reason || result.message || "disabled/condition not met"}`,
              );
              return;
            }
            console.error(
              `[heartbeat] rule=${result.ruleId} errored reason=${formatHeartbeatErrorHint(
                result.reason || result.decisionRaw || "unknown error",
              )}`,
            );
          },
          send: async ({ rule, triggerMessage }) => {
            if (!config.heartbeatTargetOpenId) {
              throw new Error("heartbeat is enabled but heartbeatTargetOpenId is not configured");
            }
            await sendFeishuTextMessage(config, {
              openId: config.heartbeatTargetOpenId,
              text: buildHeartbeatMessage(rule.ruleText, triggerMessage),
            });
          },
        })
      : undefined;

  if (heartbeatHandle) {
    heartbeatHandle
      .runOnce()
      .then((summary) => {
        console.log(`[heartbeat] startup runAt=${summary.ranAt} triggered=${summary.triggered} skipped=${summary.skipped} errors=${summary.errors}`);
        if (summary.errors > 0) {
          for (const result of summary.results) {
            if (result.status === "errored") {
              console.error(
                `[heartbeat] startup rule=${result.ruleId} error=${formatHeartbeatErrorHint(
                  result.reason || result.decisionRaw || "unknown error",
                )}`,
              );
            }
          }
        }
      })
      .catch((error) => {
        console.error(`[heartbeat] startup run failed: ${String(error instanceof Error ? error.message : error)}`);
      });
  }

  try {
    await runFeishuGatewayServer(
      overrides,
      {
        onFailureHint,
      },
      serviceContext.channel,
    );
  } finally {
    heartbeatHandle?.stop();
  }
}

async function runLocalGatewayService(
  overrides: Partial<LocalGatewayOverrides>,
  serviceContext: GatewayServiceRunContext = {
    channel: "local",
    serviceArgv: [],
  },
): Promise<void> {
  if (serviceContext.serviceChild) {
    await runLocalGatewayServer(overrides);
    return;
  }

  const paths = resolveGatewayServicePaths(serviceContext.channel, {
    statePath: serviceContext.statePath,
    logPath: serviceContext.logPath,
  });

  if (serviceContext.action === "status") {
    await printGatewayServiceStatus(paths, serviceContext.channel);
    return;
  }

  if (serviceContext.action === "stop") {
    const snapshot = await resolveGatewayServiceState(paths);
    if (!snapshot.state || !snapshot.running) {
      console.log("gateway service already stopped");
      if (snapshot.state) {
        await clearGatewayServiceState(paths.statePath);
      }
      return;
    }
    await stopGatewayServiceIfRunning(paths, snapshot.state);
    console.log(`gateway service stopped (pid=${snapshot.state.pid})`);
    return;
  }

  if (serviceContext.daemon) {
    const snapshot = await resolveGatewayServiceState(paths);
    if (snapshot.running) {
      throw new Error(`Gateway already running (pid=${snapshot.state?.pid})`);
    }

    const daemonArgv = ["gateway", "start", ...serviceContext.serviceArgv, "--service-child"];
    const scriptPath = process.argv[1];
    if (!scriptPath) {
      throw new Error("Cannot locate service entrypoint");
    }

    const daemonPid = await spawnGatewayServiceProcess(scriptPath, daemonArgv, paths);
    const daemonState: GatewayServiceState = {
      channel: serviceContext.channel,
      pid: daemonPid,
      startedAt: new Date().toISOString(),
      command: `${process.execPath} ${scriptPath} ${daemonArgv.join(" ")}`.trim(),
      statePath: paths.statePath,
      logPath: paths.logPath,
      argv: [scriptPath, ...daemonArgv],
    };
    await writeGatewayServiceState(daemonState);
    console.log(`gateway service started as daemon: pid=${daemonPid}`);
    console.log(`status: ${paths.statePath}`);
    console.log(`log: ${paths.logPath}`);
    return;
  }

  await runLocalGatewayServer(overrides);
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

  if (command === 'pairing') {
    try {
      return await runPairingCommand(argv.slice(1));
    } catch (error) {
      console.error("ERROR:", String(error instanceof Error ? error.message : error));
      return 1;
    }
  }

  if (command === 'heartbeat') {
    try {
      return await runHeartbeatCommand(argv);
    } catch (error) {
      console.error("ERROR:", String(error instanceof Error ? error.message : error));
      return 1;
    }
  }

  if (command === 'gateway') {
    try {
      if (argv.slice(1).some((arg) => arg === '--help' || arg === '-h')) {
        console.log(printUsage());
        return 0;
      }
      const [, configOrAction] = argv;
      if (configOrAction === 'config') {
        await runGatewayConfigCommand(argv.slice(2));
        return 0;
      }
      const options = parseGatewayArgs(argv.slice(1));
      const { channel, action, serviceArgv, ...gatewayOptions } = options;
      if (channel === "feishu") {
        await runFeishuGatewayWithHeartbeat(gatewayOptions, makeFeishuFailureHint, {
          channel,
          action,
          serviceChild: options.serviceChild,
          daemon: options.daemon,
          statePath: options.statePath,
          logPath: options.logPath,
          serviceArgv,
        });
        return 0;
      }

      if (channel === "local") {
        await runLocalGatewayService(gatewayOptions, {
          channel,
          action,
          serviceChild: options.serviceChild,
          daemon: options.daemon,
          statePath: options.statePath,
          logPath: options.logPath,
          serviceArgv,
        });
        return 0;
      }

      throw new Error(`Unsupported channel: ${channel}`);

    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(`[${error.code}] ${error.message}`);
      } else {
        console.error("ERROR:", String(error instanceof Error ? error.message : error));
      }
      console.error(
        "Usage:",
        "  lainclaw gateway start [--channel <channel>] [--provider <provider>] [--profile <profile>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--tool-max-steps <N>] [--memory|--no-memory] [--heartbeat-enabled|--no-heartbeat-enabled] [--heartbeat-interval-ms <ms>] [--heartbeat-target-open-id <openId>] [--heartbeat-session-key <key>] [--pairing-policy <open|allowlist|pairing|disabled>] [--pairing-allow-from <id1,id2>] [--pairing-pending-ttl-ms <ms>] [--pairing-pending-max <n>] [--app-id <id>] [--app-secret <secret>] [--request-timeout-ms <ms>] [--daemon] [--pid-file <path>] [--log-file <path>]",
        "  lainclaw gateway status [--channel <channel>] [--pid-file <path>]",
        "  lainclaw gateway stop [--channel <channel>] [--pid-file <path>]",
        "  lainclaw gateway config set [--channel <channel>] [--provider <provider>] [--profile <profile>] [--app-id <id>] [--app-secret <secret>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--tool-max-steps <N>] [--memory|--no-memory] [--heartbeat-enabled|--no-heartbeat-enabled] [--heartbeat-interval-ms <ms>] [--heartbeat-target-open-id <openId>] [--heartbeat-session-key <key>] [--pairing-policy <open|allowlist|pairing|disabled>] [--pairing-allow-from <id1,id2>] [--pairing-pending-ttl-ms <ms>] [--pairing-pending-max <n>] [--request-timeout-ms <ms>]",
        "  lainclaw gateway config show [--channel <channel>]",
        "  lainclaw gateway config clear [--channel <channel>]",
      );
      return 1;
    }
  }

  console.error(`Unknown command: ${command}`);
  return 1;
}
