import fs from "node:fs/promises";
import path from "node:path";
import { resolveAuthDirectory } from "../../auth/configStore.js";
import type { PairingPolicy } from "../../pairing/pairing-store.js";
import { DEFAULT_PAIRING_PENDING_MAX, DEFAULT_PAIRING_PENDING_TTL_MS } from "../../pairing/pairing-store.js";

export interface FeishuGatewayConfig {
  /**
   * Gateway-level runtime config for Feishu channel invocation.
   * `channel` is only used to select which cache file stores this config;
   * it is not a nested field inside FeishuGatewayConfig.
   */
  appId?: string;
  appSecret?: string;
  requestTimeoutMs: number;
  provider: string;
  profileId?: string;
  withTools: boolean;
  memory: boolean;
  heartbeatEnabled: boolean;
  heartbeatIntervalMs: number;
  heartbeatTargetOpenId?: string;
  heartbeatSessionKey?: string;
  toolAllow?: string[];
  toolMaxSteps?: number;
  pairingPolicy?: PairingPolicy;
  pairingPendingTtlMs?: number;
  pairingPendingMax?: number;
  pairingAllowFrom?: string[];
}

interface FeishuGatewayStorage {
  version: 1;
  config: {
    appId?: string;
    appSecret?: string;
    requestTimeoutMs?: number;
    provider?: string;
    profileId?: string;
    withTools?: boolean;
    memory?: boolean;
    heartbeatEnabled?: boolean;
    heartbeatIntervalMs?: number;
    heartbeatTargetOpenId?: string;
    heartbeatSessionKey?: string;
    toolAllow?: string[];
    toolMaxSteps?: number;
    pairingPolicy?: PairingPolicy;
    pairingPendingTtlMs?: number;
    pairingPendingMax?: number;
    pairingAllowFrom?: string[];
  };
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_PROVIDER = "openai-codex";
const DEFAULT_WITH_TOOLS = true;
const DEFAULT_MEMORY = false;
const DEFAULT_HEARTBEAT_ENABLED = false;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5 * 60_000;
const DEFAULT_HEARTBEAT_SESSION_KEY = "heartbeat";
const DEFAULT_PAIRING_POLICY = "open" as PairingPolicy;
// Channel name is only a namespace for persisted configuration storage.
// Default namespace `feishu` resolves to `feishu-gateway.json`.
const FEISHU_GATEWAY_CONFIG_FILE = "feishu-gateway.json";
const CURRENT_VERSION = 1 as const;
const DEFAULT_CHANNEL = "feishu";

const CONFIG_FILE_SUFFIX = "-gateway.json";

function resolveText(raw: string | undefined): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim();
}

function isValidProvider(raw: string | undefined): string | undefined {
  const normalized = resolveText(raw).toLowerCase();
  if (normalized === "openai-codex") {
    return normalized;
  }
  return undefined;
}

function isValidPairingPolicy(raw: string | undefined): PairingPolicy | undefined {
  const normalized = resolveText(raw).toLowerCase();
  if (["open", "allowlist", "pairing", "disabled"].includes(normalized)) {
    return normalized as PairingPolicy;
  }
  return undefined;
}

function resolveBoolean(raw: string | undefined): boolean | undefined {
  const normalized = resolveText(raw).toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (["1", "true", "on", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function normalizeAllowFrom(raw: string[] | undefined): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => resolveText(String(entry)).toLowerCase())
    .filter((entry) => entry.length > 0);
}

function normalizeAllowFromRaw(raw: unknown): string[] {
  if (typeof raw === "string") {
    return parseToolAllowRaw(raw) ?? [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  return normalizeAllowFrom(raw);
}

function parseToolAllowRaw(raw: string | undefined): string[] | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeToolAllow(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
  }
  if (typeof raw === "string") {
    return parseToolAllowRaw(raw);
  }
  return undefined;
}

function parseToolMaxStepsRaw(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim();
    if (!normalized) {
      return undefined;
    }
    const parsed = Number.parseInt(normalized, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function firstToolAllow(
  ...values: Array<string[] | string | undefined>
): string[] | undefined {
  for (const value of values) {
    const normalized = normalizeToolAllow(value);
    if (normalized !== undefined) {
      return normalized;
    }
  }
  return undefined;
}

function normalizeGatewayChannel(rawChannel: string | undefined): string {
  const trimmed = (rawChannel || "").trim().toLowerCase();
  if (!trimmed) {
    return DEFAULT_CHANNEL;
  }
  return trimmed.replace(/[^a-z0-9._-]+/g, "-");
}

function resolveConfigPath(rawChannel: string = DEFAULT_CHANNEL): string {
  const channel = normalizeGatewayChannel(rawChannel);
  const fileName =
    channel === DEFAULT_CHANNEL ? FEISHU_GATEWAY_CONFIG_FILE : `${channel}${CONFIG_FILE_SUFFIX}`;
  return path.join(resolveAuthDirectory(), fileName);
}

export function resolveFeishuGatewayConfigPath(rawChannel: string = DEFAULT_CHANNEL): string {
  return resolveConfigPath(rawChannel);
}

function normalizeStoredConfig(raw: unknown): Partial<FeishuGatewayConfig> {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const source = raw as Partial<FeishuGatewayStorage["config"]>;
  const appId = typeof source.appId === "string" ? resolveText(source.appId) : undefined;
  const appSecret = typeof source.appSecret === "string" ? resolveText(source.appSecret) : undefined;
  const requestTimeoutMs =
    typeof source.requestTimeoutMs === "number" && Number.isFinite(source.requestTimeoutMs)
      ? source.requestTimeoutMs
      : undefined;
  const provider = isValidProvider(typeof source.provider === "string" ? source.provider : undefined);
  const profileId = typeof source.profileId === "string" ? resolveText(source.profileId) : undefined;
  const withTools =
    typeof source.withTools === "boolean"
      ? source.withTools
      : source.withTools === "true"
        ? true
        : source.withTools === "false"
          ? false
          : undefined;
  const memory =
    typeof source.memory === "boolean"
      ? source.memory
      : source.memory === "true"
        ? true
        : source.memory === "false"
          ? false
          : undefined;
  const heartbeatEnabled =
    typeof source.heartbeatEnabled === "boolean"
      ? source.heartbeatEnabled
      : source.heartbeatEnabled === "true"
        ? true
        : source.heartbeatEnabled === "false"
          ? false
          : undefined;
  const heartbeatIntervalMs =
    typeof source.heartbeatIntervalMs === "number" && Number.isFinite(source.heartbeatIntervalMs)
      ? source.heartbeatIntervalMs
      : undefined;
  const heartbeatTargetOpenId =
    typeof source.heartbeatTargetOpenId === "string"
      ? resolveText(source.heartbeatTargetOpenId)
      : undefined;
  const heartbeatSessionKey =
    typeof source.heartbeatSessionKey === "string" ? resolveText(source.heartbeatSessionKey) : undefined;
  const toolAllow = normalizeToolAllow(source.toolAllow as unknown);
  const toolMaxSteps = parseToolMaxStepsRaw(source.toolMaxSteps as unknown);
  const pairingPolicy = isValidPairingPolicy(
    typeof source.pairingPolicy === "string" ? source.pairingPolicy : undefined,
  );
  const pairingPendingTtlMs =
    typeof source.pairingPendingTtlMs === "number" && Number.isFinite(source.pairingPendingTtlMs)
      ? source.pairingPendingTtlMs
      : undefined;
  const pairingPendingMax =
    typeof source.pairingPendingMax === "number" && Number.isFinite(source.pairingPendingMax)
      ? source.pairingPendingMax
      : undefined;
  const pairingAllowFrom = normalizeAllowFromRaw(source.pairingAllowFrom as unknown);

  const normalized: Partial<FeishuGatewayConfig> = {};
  if (appId) {
    normalized.appId = appId;
  }
  if (appSecret) {
    normalized.appSecret = appSecret;
  }
  if (provider) {
    normalized.provider = provider;
  }
  if (profileId) {
    normalized.profileId = profileId;
  }
  if (typeof withTools === "boolean") {
    normalized.withTools = withTools;
  }
  if (typeof memory === "boolean") {
    normalized.memory = memory;
  }
  if (typeof heartbeatEnabled === "boolean") {
    normalized.heartbeatEnabled = heartbeatEnabled;
  }
  if (typeof heartbeatIntervalMs === "number" && heartbeatIntervalMs > 0) {
    normalized.heartbeatIntervalMs = heartbeatIntervalMs;
  }
  if (heartbeatTargetOpenId) {
    normalized.heartbeatTargetOpenId = heartbeatTargetOpenId;
  }
  if (heartbeatSessionKey) {
    normalized.heartbeatSessionKey = heartbeatSessionKey;
  }
  if (Array.isArray(toolAllow)) {
    normalized.toolAllow = toolAllow;
  }
  if (typeof toolMaxSteps === "number" && Number.isFinite(toolMaxSteps) && toolMaxSteps > 0) {
    normalized.toolMaxSteps = toolMaxSteps;
  }
  if (pairingPolicy) {
    normalized.pairingPolicy = pairingPolicy;
  }
  if (typeof pairingPendingTtlMs === "number" && pairingPendingTtlMs > 0) {
    normalized.pairingPendingTtlMs = pairingPendingTtlMs;
  }
  if (typeof pairingPendingMax === "number" && pairingPendingMax > 0) {
    normalized.pairingPendingMax = pairingPendingMax;
  }
  if (pairingAllowFrom.length > 0) {
    normalized.pairingAllowFrom = pairingAllowFrom;
  }
  if (typeof requestTimeoutMs === "number" && requestTimeoutMs > 0) {
    normalized.requestTimeoutMs = requestTimeoutMs;
  }
  return normalized;
}

function firstString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = resolveText(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function firstBoolean(...values: Array<boolean | string | undefined>): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = resolveBoolean(value);
      if (typeof normalized === "boolean") {
        return normalized;
      }
    }
  }
  return undefined;
}

function firstNumber(...values: Array<number | string | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value.trim(), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return undefined;
}

export async function loadCachedFeishuGatewayConfig(
  channel: string = DEFAULT_CHANNEL,
): Promise<Partial<FeishuGatewayConfig>> {
  try {
    const file = await fs.readFile(resolveConfigPath(channel), "utf-8");
    const parsed = JSON.parse(file) as Partial<FeishuGatewayStorage>;
    if (!parsed || parsed.version !== CURRENT_VERSION || !parsed.config || typeof parsed.config !== "object") {
      return {};
    }
    return normalizeStoredConfig(parsed.config);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    return {};
  }
}

function filterPersistable(updates: Partial<FeishuGatewayConfig>): Partial<FeishuGatewayConfig> {
  return {
    ...(typeof updates.appId === "string" && updates.appId.trim() ? { appId: updates.appId.trim() } : {}),
    ...(typeof updates.appSecret === "string" && updates.appSecret.trim() ? { appSecret: updates.appSecret.trim() } : {}),
    ...(typeof updates.requestTimeoutMs === "number" && Number.isFinite(updates.requestTimeoutMs) && updates.requestTimeoutMs > 0
      ? { requestTimeoutMs: updates.requestTimeoutMs }
      : {}),
    ...(typeof updates.provider === "string" ? { provider: updates.provider } : {}),
    ...(typeof updates.profileId === "string" ? { profileId: updates.profileId } : {}),
    ...(typeof updates.withTools === "boolean" ? { withTools: updates.withTools } : {}),
    ...(typeof updates.memory === "boolean" ? { memory: updates.memory } : {}),
    ...(Array.isArray(updates.toolAllow)
      ? { toolAllow: updates.toolAllow.map((tool) => tool.trim()).filter((tool) => tool.length > 0) }
      : {}),
    ...(typeof updates.toolMaxSteps === "number" && Number.isFinite(updates.toolMaxSteps) && updates.toolMaxSteps > 0
      ? { toolMaxSteps: updates.toolMaxSteps }
      : {}),
    ...(typeof updates.heartbeatEnabled === "boolean" ? { heartbeatEnabled: updates.heartbeatEnabled } : {}),
    ...(typeof updates.heartbeatIntervalMs === "number" && Number.isFinite(updates.heartbeatIntervalMs)
      ? { heartbeatIntervalMs: updates.heartbeatIntervalMs }
      : {}),
    ...(typeof updates.heartbeatTargetOpenId === "string" && updates.heartbeatTargetOpenId.trim()
      ? { heartbeatTargetOpenId: updates.heartbeatTargetOpenId.trim() }
      : {}),
    ...(typeof updates.heartbeatSessionKey === "string" && updates.heartbeatSessionKey.trim()
      ? { heartbeatSessionKey: updates.heartbeatSessionKey.trim() }
      : {}),
    ...(typeof updates.pairingPolicy === "string"
      ? { pairingPolicy: isValidPairingPolicy(updates.pairingPolicy) }
      : {}),
    ...(typeof updates.pairingPendingTtlMs === "number"
      && Number.isFinite(updates.pairingPendingTtlMs)
      && updates.pairingPendingTtlMs > 0
      ? { pairingPendingTtlMs: updates.pairingPendingTtlMs }
      : {}),
    ...(typeof updates.pairingPendingMax === "number"
      && Number.isFinite(updates.pairingPendingMax)
      && updates.pairingPendingMax > 0
      ? { pairingPendingMax: updates.pairingPendingMax }
      : {}),
    ...(Array.isArray(updates.pairingAllowFrom)
      ? {
          pairingAllowFrom: normalizeAllowFrom(updates.pairingAllowFrom),
        }
      : {}),
  };
}

export async function persistFeishuGatewayConfig(
  updates: Partial<FeishuGatewayConfig>,
  channel: string = DEFAULT_CHANNEL,
): Promise<void> {
  const filtered = filterPersistable(updates);
  if (Object.keys(filtered).length === 0) {
    return;
  }

  const cached = await loadCachedFeishuGatewayConfig(channel);
  const next: FeishuGatewayStorage = {
    version: CURRENT_VERSION,
    config: {
      ...cached,
      ...filtered,
    },
  };
  await fs.mkdir(resolveAuthDirectory(), { recursive: true });
  const filePath = resolveConfigPath(channel);
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), "utf-8");
}

export async function clearFeishuGatewayConfig(channel: string = DEFAULT_CHANNEL): Promise<void> {
  try {
    await fs.unlink(resolveConfigPath(channel));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export async function resolveFeishuGatewayConfig(
  overrides: Partial<FeishuGatewayConfig> = {},
  channel: string = DEFAULT_CHANNEL,
): Promise<FeishuGatewayConfig> {
  const cached = await loadCachedFeishuGatewayConfig(channel);

  const envAppId = resolveText(process.env.LAINCLAW_FEISHU_APP_ID || process.env.FEISHU_APP_ID);
  const envAppSecret = resolveText(process.env.LAINCLAW_FEISHU_APP_SECRET || process.env.FEISHU_APP_SECRET);
  const envRequestTimeoutMs = resolveText(
    process.env.LAINCLAW_FEISHU_REQUEST_TIMEOUT_MS || process.env.FEISHU_REQUEST_TIMEOUT_MS,
  );
  const envProvider = isValidProvider(process.env.LAINCLAW_FEISHU_PROVIDER || process.env.FEISHU_PROVIDER);
  const envProfileId = resolveText(process.env.LAINCLAW_FEISHU_PROFILE_ID || process.env.FEISHU_PROFILE_ID);
  const envWithTools = resolveBoolean(process.env.LAINCLAW_FEISHU_WITH_TOOLS || process.env.FEISHU_WITH_TOOLS);
  const envMemory = resolveBoolean(process.env.LAINCLAW_FEISHU_MEMORY || process.env.FEISHU_MEMORY);
  const envToolAllow = parseToolAllowRaw(
    process.env.LAINCLAW_FEISHU_TOOL_ALLOW || process.env.FEISHU_TOOL_ALLOW,
  );
  const envToolMaxSteps = resolveText(
    process.env.LAINCLAW_FEISHU_TOOL_MAX_STEPS || process.env.FEISHU_TOOL_MAX_STEPS,
  );
  const envHeartbeatEnabled = resolveText(
    process.env.LAINCLAW_FEISHU_HEARTBEAT_ENABLED || process.env.FEISHU_HEARTBEAT_ENABLED,
  );
  const envHeartbeatIntervalMs = resolveText(
    process.env.LAINCLAW_FEISHU_HEARTBEAT_INTERVAL_MS || process.env.FEISHU_HEARTBEAT_INTERVAL_MS,
  );
  const envHeartbeatTargetOpenId = resolveText(
    process.env.LAINCLAW_FEISHU_HEARTBEAT_TARGET_OPEN_ID || process.env.FEISHU_HEARTBEAT_TARGET_OPEN_ID,
  );
  const envHeartbeatSessionKey = resolveText(
    process.env.LAINCLAW_FEISHU_HEARTBEAT_SESSION_KEY || process.env.FEISHU_HEARTBEAT_SESSION_KEY,
  );
  const envPairingPolicy = isValidPairingPolicy(
    process.env.LAINCLAW_FEISHU_PAIRING_POLICY || process.env.FEISHU_PAIRING_POLICY,
  );
  const envPairingPendingTtlMs = resolveText(
    process.env.LAINCLAW_FEISHU_PAIRING_PENDING_TTL_MS || process.env.FEISHU_PAIRING_PENDING_TTL_MS,
  );
  const envPairingPendingMax = resolveText(
    process.env.LAINCLAW_FEISHU_PAIRING_PENDING_MAX || process.env.FEISHU_PAIRING_PENDING_MAX,
  );
  const envPairingAllowFrom = parseToolAllowRaw(
    process.env.LAINCLAW_FEISHU_PAIRING_ALLOW_FROM || process.env.FEISHU_PAIRING_ALLOW_FROM,
  );

  return {
    appId: firstString(overrides.appId, cached.appId, envAppId),
    appSecret: firstString(overrides.appSecret, cached.appSecret, envAppSecret),
    requestTimeoutMs:
      firstNumber(overrides.requestTimeoutMs, cached.requestTimeoutMs, envRequestTimeoutMs) ||
      DEFAULT_REQUEST_TIMEOUT_MS,
    provider: firstString(
      isValidProvider(overrides.provider),
      cached.provider,
      envProvider,
      DEFAULT_PROVIDER,
    )!,
      profileId: firstString(overrides.profileId, cached.profileId, envProfileId),
    withTools: firstBoolean(
      overrides.withTools,
      cached.withTools,
      envWithTools,
      DEFAULT_WITH_TOOLS,
    ) ?? DEFAULT_WITH_TOOLS,
    memory: firstBoolean(
      overrides.memory,
      cached.memory,
      envMemory,
      DEFAULT_MEMORY,
    ) ?? DEFAULT_MEMORY,
    heartbeatEnabled: firstBoolean(
      overrides.heartbeatEnabled,
      cached.heartbeatEnabled,
      resolveBoolean(envHeartbeatEnabled),
      DEFAULT_HEARTBEAT_ENABLED,
    ) ?? DEFAULT_HEARTBEAT_ENABLED,
    heartbeatIntervalMs:
      firstNumber(overrides.heartbeatIntervalMs, cached.heartbeatIntervalMs, envHeartbeatIntervalMs)
      || DEFAULT_HEARTBEAT_INTERVAL_MS,
    heartbeatTargetOpenId: firstString(
      overrides.heartbeatTargetOpenId,
      cached.heartbeatTargetOpenId,
      envHeartbeatTargetOpenId,
    ),
    heartbeatSessionKey: firstString(
      overrides.heartbeatSessionKey,
      cached.heartbeatSessionKey,
      envHeartbeatSessionKey,
      DEFAULT_HEARTBEAT_SESSION_KEY,
    ),
    toolAllow: firstToolAllow(overrides.toolAllow, cached.toolAllow, envToolAllow),
    toolMaxSteps: firstNumber(overrides.toolMaxSteps, cached.toolMaxSteps, envToolMaxSteps) || undefined,
    pairingPolicy:
      isValidPairingPolicy(overrides.pairingPolicy)
      || isValidPairingPolicy(cached.pairingPolicy)
      || envPairingPolicy
      || DEFAULT_PAIRING_POLICY,
    pairingPendingTtlMs:
      firstNumber(
        overrides.pairingPendingTtlMs,
        cached.pairingPendingTtlMs,
        envPairingPendingTtlMs,
      ) || DEFAULT_PAIRING_PENDING_TTL_MS,
    pairingPendingMax:
      firstNumber(
        overrides.pairingPendingMax,
        cached.pairingPendingMax,
        envPairingPendingMax,
      ) || DEFAULT_PAIRING_PENDING_MAX,
    pairingAllowFrom: firstToolAllow(overrides.pairingAllowFrom, cached.pairingAllowFrom, envPairingAllowFrom),
  };
}
