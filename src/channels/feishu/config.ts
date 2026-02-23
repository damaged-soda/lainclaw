import fs from "node:fs/promises";
import path from "node:path";
import { resolveAuthDirectory } from "../../auth/configStore.js";
import type { PairingPolicy, PairingRequest } from "../../pairing/pairing-store.js";
import { DEFAULT_PAIRING_PENDING_MAX, DEFAULT_PAIRING_PENDING_TTL_MS } from "../../pairing/pairing-store.js";
import { getBuiltinToolNames } from "../../tools/registry.js";

export interface FeishuGatewayConfig {
  /**
   * Gateway-level runtime config for Feishu channel invocation.
   * `channel` is only used to select runtime config scope.
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

export interface FeishuGatewayConfigSources {
  appId?: "default" | "override";
  appSecret?: "default" | "override";
  requestTimeoutMs?: "default" | "override";
  provider?: "default" | "override";
  profileId?: "default" | "override";
  withTools?: "default" | "override";
  memory?: "default" | "override";
  heartbeatEnabled?: "default" | "override";
  heartbeatIntervalMs?: "default" | "override";
  heartbeatTargetOpenId?: "default" | "override";
  heartbeatSessionKey?: "default" | "override";
  toolAllow?: "default" | "override";
  toolMaxSteps?: "default" | "override";
  pairingPolicy?: "default" | "override";
  pairingPendingTtlMs?: "default" | "override";
  pairingPendingMax?: "default" | "override";
  pairingAllowFrom?: "default" | "override";
}

interface FeishuPairingChannelState {
  requests: PairingRequest[];
  allowFrom?: string[];
  accountAllowFrom?: Record<string, string[]>;
}

export interface FeishuGatewayStorage {
  version: 1;
  default?: Partial<FeishuGatewayConfig>;
  channels?: Record<string, Partial<FeishuGatewayConfig>>;
  pairing?: {
    version: 1;
    channels?: Record<string, FeishuPairingChannelState>;
  };
  config?: {
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
const DEFAULT_TOOL_ALLOW = getBuiltinToolNames();
const FEISHU_GATEWAY_CONFIG_FILE = "gateway.json";
const LEGACY_FEISHU_GATEWAY_CONFIG_SUFFIX = "-gateway.json";
const CURRENT_VERSION = 1 as const;
const DEFAULT_CHANNEL = "default";
const DEFAULT_RUNTIME_CHANNEL = "feishu";
const GLOBAL_SCOPE_KEYS: Array<keyof FeishuGatewayConfig> = ["provider"];
const FEISHU_GATEWAY_CONFIG_KEYS: Array<keyof FeishuGatewayConfig> = [
  "appId",
  "appSecret",
  "requestTimeoutMs",
  "provider",
  "profileId",
  "withTools",
  "memory",
  "heartbeatEnabled",
  "heartbeatIntervalMs",
  "heartbeatTargetOpenId",
  "heartbeatSessionKey",
  "toolAllow",
  "toolMaxSteps",
  "pairingPolicy",
  "pairingPendingTtlMs",
  "pairingPendingMax",
  "pairingAllowFrom",
];

function hasOwn<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

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

function normalizeChannelOverrides(raw: Partial<FeishuGatewayConfig>): Partial<FeishuGatewayConfig> {
  const output: Partial<FeishuGatewayConfig> = { ...raw };
  for (const key of GLOBAL_SCOPE_KEYS) {
    delete output[key];
  }
  return output;
}

function resolveConfigPath(rawChannel: string = DEFAULT_CHANNEL): string {
  void rawChannel;
  return path.join(resolveAuthDirectory(), FEISHU_GATEWAY_CONFIG_FILE);
}

function resolveLegacyConfigPath(rawChannel: string = DEFAULT_RUNTIME_CHANNEL): string {
  const channel = normalizeGatewayChannel(rawChannel);
  return path.join(resolveAuthDirectory(), `${channel}${LEGACY_FEISHU_GATEWAY_CONFIG_SUFFIX}`);
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

function normalizeStorageLayer(raw: unknown): Partial<FeishuGatewayConfig> {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  return normalizeStoredConfig(raw);
}

function normalizePairingState(
  raw: unknown,
): { version: 1; channels?: Record<string, FeishuPairingChannelState> } {
  const fallback = { version: CURRENT_VERSION };
  if (!isRecord(raw)) {
    return fallback;
  }
  if (raw.version !== CURRENT_VERSION) {
    return fallback;
  }
  const channelsCandidate = isRecord(raw.channels) ? raw.channels : undefined;
  if (!channelsCandidate) {
    return { version: CURRENT_VERSION };
  }

  const channels: Record<string, {
    requests: PairingRequest[];
    allowFrom?: string[];
    accountAllowFrom?: Record<string, string[]>;
  }> = {};
  for (const [rawChannel, rawScope] of Object.entries(channelsCandidate)) {
    const normalizedScope = isRecord(rawScope)
      ? {
          ...(Array.isArray(rawScope.requests) ? { requests: rawScope.requests as PairingRequest[] } : { requests: [] }),
          ...(Array.isArray(rawScope.allowFrom) ? { allowFrom: rawScope.allowFrom as string[] } : {}),
          ...(isRecord(rawScope.accountAllowFrom)
            ? { accountAllowFrom: rawScope.accountAllowFrom as Record<string, string[]> }
            : {}),
        }
      : { requests: [], allowFrom: [], accountAllowFrom: {} };
    if (
      normalizedScope.requests.length > 0
      || (normalizedScope.allowFrom?.length ?? 0) > 0
      || (Object.keys(normalizedScope.accountAllowFrom ?? {}).length > 0)
    ) {
      channels[rawChannel] = normalizedScope;
    }
  }
  if (Object.keys(channels).length === 0) {
    return { version: CURRENT_VERSION };
  }
  return { version: CURRENT_VERSION, channels };
}

function isFeishuGatewayStorage(raw: unknown): raw is FeishuGatewayStorage {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const candidate = raw as Partial<FeishuGatewayStorage>;
  if (candidate.version !== CURRENT_VERSION) {
    return false;
  }
  if (candidate.default !== undefined && (candidate.default === null || typeof candidate.default !== "object")) {
    return false;
  }
  if (candidate.channels !== undefined) {
    if (!candidate.channels || typeof candidate.channels !== "object") {
      return false;
    }
  }
  if (candidate.pairing !== undefined) {
    if (candidate.pairing === null || typeof candidate.pairing !== "object") {
      return false;
    }
    if (candidate.pairing.version !== CURRENT_VERSION) {
      return false;
    }
    if (candidate.pairing.channels !== undefined && (candidate.pairing.channels === null || typeof candidate.pairing.channels !== "object")) {
      return false;
    }
  }
  return true;
}

async function loadFeishuGatewayStore(): Promise<FeishuGatewayStorage | null> {
  try {
    const file = await fs.readFile(resolveConfigPath(), "utf-8");
    const parsed = JSON.parse(file);
    if (!isFeishuGatewayStorage(parsed)) {
      return null;
    }
    const normalizedChannels: Record<string, Partial<FeishuGatewayConfig>> = {};
    if (parsed.channels && typeof parsed.channels === "object") {
      for (const [rawName, rawScope] of Object.entries(parsed.channels)) {
        const normalizedName = normalizeGatewayChannel(rawName);
        const normalizedScope = normalizeStorageLayer(rawScope);
        if (Object.keys(normalizedScope).length > 0) {
          normalizedChannels[normalizedName] = normalizedScope;
        }
      }
    }
  const normalizedDefault = normalizeStorageLayer(parsed.default);
  const normalizedLegacyConfig = normalizeStorageLayer(
      Object.prototype.hasOwnProperty.call(parsed, "config") ? parsed.config : undefined,
    );
  const normalizedPairing = normalizePairingState(parsed.pairing);

    return {
      version: CURRENT_VERSION,
      ...(Object.keys(normalizedDefault).length > 0 ? { default: normalizedDefault } : {}),
      ...(Object.keys(normalizedChannels).length > 0 ? { channels: normalizedChannels } : {}),
      ...(Object.keys(normalizedPairing).length > 0 ? { pairing: normalizedPairing } : {}),
      ...(Object.keys(normalizedLegacyConfig).length > 0 ? { config: normalizedLegacyConfig } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    return null;
  }
}

export async function listLegacyFeishuGatewayConfigChannels(): Promise<string[]> {
  try {
    const entries = await fs.readdir(resolveAuthDirectory(), { withFileTypes: true });
    const legacyChannels = new Set<string>();
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      if (!entry.name.endsWith(LEGACY_FEISHU_GATEWAY_CONFIG_SUFFIX)) {
        continue;
      }
      if (entry.name === FEISHU_GATEWAY_CONFIG_FILE) {
        continue;
      }
      const channel = entry.name.slice(
        0,
        entry.name.length - LEGACY_FEISHU_GATEWAY_CONFIG_SUFFIX.length,
      );
      if (!channel) {
        continue;
      }
      legacyChannels.add(normalizeGatewayChannel(channel));
    }
    return [...legacyChannels];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    return [];
  }
}

function deriveScopeFromLegacyChannel(rawChannel: string): string {
  return normalizeGatewayChannel(rawChannel);
}

function extractConfigSources(
  defaultScope: Partial<FeishuGatewayConfig>,
  channelScope: Partial<FeishuGatewayConfig>,
): FeishuGatewayConfigSources {
  const sources: FeishuGatewayConfigSources = {};
  for (const key of FEISHU_GATEWAY_CONFIG_KEYS) {
    if (hasOwn(channelScope, key)) {
      if (key === "provider") {
        continue;
      }
      sources[key] = "override";
    } else if (hasOwn(defaultScope, key)) {
      sources[key] = "default";
    }
  }
  return sources;
}

async function loadLegacyFeishuGatewayConfig(rawChannel: string): Promise<Partial<FeishuGatewayConfig>> {
  try {
    const file = await fs.readFile(resolveLegacyConfigPath(rawChannel), "utf-8");
    const parsed = JSON.parse(file);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    if (isFeishuGatewayStorage(parsed)) {
      if (parsed.config) {
        return normalizeStorageLayer(parsed.config);
      }
    }
    return normalizeStorageLayer(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    return {};
  }
}

async function writeFeishuGatewayStore(store: FeishuGatewayStorage): Promise<void> {
  const next: FeishuGatewayStorage = {
    version: CURRENT_VERSION,
    ...(store.default && { default: store.default }),
    ...(store.channels && { channels: store.channels }),
    ...(store.pairing && { pairing: store.pairing }),
  };
  await fs.mkdir(resolveAuthDirectory(), { recursive: true });
  await fs.writeFile(resolveConfigPath(), JSON.stringify(next, null, 2), "utf-8");
}

async function clearOrDeleteFeishuGatewayStore(): Promise<void> {
  try {
    await fs.unlink(resolveConfigPath());
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function hasPairingData(pairing?: FeishuGatewayStorage["pairing"]): boolean {
  return !!(
    pairing?.channels
    && isRecord(pairing.channels)
    && Object.keys(pairing.channels).length > 0
  );
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
  const normalizedChannel = normalizeGatewayChannel(channel);
  const store = await loadFeishuGatewayStore();
  if (store) {
    const scopedConfig =
      normalizedChannel === DEFAULT_CHANNEL
        ? {}
        : normalizeChannelOverrides(normalizeStorageLayer(store.channels?.[normalizedChannel]));
    const merged = {
      ...(store.default ? normalizeStorageLayer(store.default) : {}),
      ...scopedConfig,
    };
    return merged;
  }

  const legacyChannel =
    normalizedChannel === DEFAULT_CHANNEL ? DEFAULT_RUNTIME_CHANNEL : normalizedChannel;
  return loadLegacyFeishuGatewayConfig(legacyChannel);
}

export async function loadCachedFeishuGatewayConfigWithSources(
  channel: string = DEFAULT_CHANNEL,
): Promise<{ config: Partial<FeishuGatewayConfig>; sources: FeishuGatewayConfigSources }> {
  const normalizedChannel = normalizeGatewayChannel(channel);
  const store = await loadFeishuGatewayStore();
  if (store) {
    const scopedConfig = normalizeChannelOverrides(normalizeStorageLayer(
      normalizedChannel === DEFAULT_CHANNEL ? {} : store.channels?.[normalizedChannel],
    ));
    const defaultConfig = normalizeStorageLayer(store.default);
    return {
      config: {
        ...defaultConfig,
        ...scopedConfig,
      },
      sources: extractConfigSources(defaultConfig, scopedConfig),
    };
  }

  const legacyChannel =
    normalizedChannel === DEFAULT_CHANNEL ? DEFAULT_RUNTIME_CHANNEL : normalizedChannel;
  const loaded = await loadLegacyFeishuGatewayConfig(legacyChannel);
  const sourceScope = normalizedChannel === DEFAULT_CHANNEL ? "default" : "override";
  const sources: FeishuGatewayConfigSources = {};
  for (const key of FEISHU_GATEWAY_CONFIG_KEYS) {
    if (hasOwn(loaded, key)) {
      if (key === "provider") {
        sources[key] = "default";
      } else {
        sources[key] = sourceScope;
      }
    }
  }
  return { config: loaded, sources };
}

export async function buildFeishuGatewayConfigMigrationDraft(
  channel?: string,
): Promise<FeishuGatewayStorage> {
  const rawChannel = channel ? normalizeGatewayChannel(channel) : undefined;
  const store = await loadFeishuGatewayStore();
  const draft: FeishuGatewayStorage = store
    ? {
        version: CURRENT_VERSION,
        ...(store.default ? { default: normalizeStorageLayer(store.default) } : {}),
        ...(store.channels ? { channels: store.channels } : {}),
      }
    : { version: CURRENT_VERSION };

  const legacyChannels = await listLegacyFeishuGatewayConfigChannels();
  for (const legacyChannel of legacyChannels) {
    const scope = deriveScopeFromLegacyChannel(legacyChannel);
    if (rawChannel && rawChannel !== scope) {
      continue;
    }
    const legacyConfig = await loadLegacyFeishuGatewayConfig(legacyChannel);
    if (Object.keys(legacyConfig).length === 0) {
      continue;
    }
    const provider = legacyConfig.provider;
    if (provider) {
      const nextDefaultConfig = {
        ...(draft.default ?? {}),
        provider,
      };
      if (Object.keys(nextDefaultConfig).length > 0) {
        draft.default = nextDefaultConfig;
      }
      delete legacyConfig.provider;
    }

    draft.channels = {
      ...(draft.channels ?? {}),
    };
    const currentChannelConfig = normalizeStorageLayer(draft.channels[scope]);
    const nextChannelConfig = {
      ...legacyConfig,
      ...currentChannelConfig,
    };
    if (Object.keys(nextChannelConfig).length > 0) {
      draft.channels[scope] = nextChannelConfig;
    }
  }

  if (!draft.default && (!draft.channels || Object.keys(draft.channels).length === 0)) {
    delete draft.config;
    return { version: CURRENT_VERSION };
  }

  return draft;
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

  const normalizedChannel = normalizeGatewayChannel(channel);
  const persistedStore = await loadFeishuGatewayStore();
  const store = persistedStore ?? { version: CURRENT_VERSION };
  const hasStore = !!persistedStore;
  const legacyBaseChannel =
    normalizedChannel === DEFAULT_CHANNEL ? DEFAULT_RUNTIME_CHANNEL : normalizedChannel;
  const legacy = hasStore ? {} : await loadLegacyFeishuGatewayConfig(legacyBaseChannel);
  const provider = typeof filtered.provider === "string" ? filtered.provider : undefined;
  const scopedUpdates = normalizeChannelOverrides(filtered);

  if (normalizedChannel === DEFAULT_CHANNEL) {
    const defaultConfig = {
      ...(store.default ? normalizeStorageLayer(store.default) : legacy),
      ...scopedUpdates,
    };
    if (provider) {
      defaultConfig.provider = provider;
    }
    if (Object.keys(defaultConfig).length > 0) {
      store.default = defaultConfig;
    }
  } else {
    if (provider) {
      const defaultConfig = {
        ...(store.default ? normalizeStorageLayer(store.default) : legacy),
        provider,
      };
      if (Object.keys(defaultConfig).length > 0) {
        store.default = defaultConfig;
      }
    }

    if (Object.keys(scopedUpdates).length > 0) {
      const channelConfig = normalizeStorageLayer(store.channels?.[normalizedChannel]);
      const baseChannelConfig = Object.keys(channelConfig).length > 0
        ? channelConfig
        : await loadLegacyFeishuGatewayConfig(legacyBaseChannel);
      const nextConfig = {
        ...baseChannelConfig,
        ...scopedUpdates,
      };
      if (Object.keys(nextConfig).length > 0) {
        store.channels = {
          ...(store.channels ?? {}),
          [normalizedChannel]: nextConfig,
        };
      } else {
        if (store.channels) {
          delete store.channels[normalizedChannel];
          if (Object.keys(store.channels).length === 0) {
            delete store.channels;
          }
        }
      }
    }
  }

  if (!store.default && Object.keys(store.channels ?? {}).length === 0) {
    if (hasPairingData(store.pairing)) {
      await writeFeishuGatewayStore(store);
      return;
    }
    await clearOrDeleteFeishuGatewayStore();
    return;
  }
  await writeFeishuGatewayStore(store);
}

export async function clearFeishuGatewayConfig(channel: string = DEFAULT_CHANNEL): Promise<void> {
  const normalizedChannel = normalizeGatewayChannel(channel);
  const store = await loadFeishuGatewayStore();
  if (!store) {
    return;
  }

  if (normalizedChannel === DEFAULT_CHANNEL) {
    if (store.default) {
      delete store.default;
    }
  } else if (store.channels) {
    delete store.channels[normalizedChannel];
    if (Object.keys(store.channels).length === 0) {
      delete store.channels;
    }
  }

  if (!store.default && (!store.channels || Object.keys(store.channels).length === 0)) {
    if (hasPairingData(store.pairing)) {
      await writeFeishuGatewayStore(store);
      return;
    }
    await clearOrDeleteFeishuGatewayStore();
    return;
  }

  await writeFeishuGatewayStore(store);
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
    appId: firstString(overrides.appId, envAppId, cached.appId),
    appSecret: firstString(overrides.appSecret, envAppSecret, cached.appSecret),
    requestTimeoutMs:
      firstNumber(
        overrides.requestTimeoutMs,
        envRequestTimeoutMs,
        cached.requestTimeoutMs,
      ) ||
      DEFAULT_REQUEST_TIMEOUT_MS,
    provider: firstString(
      isValidProvider(overrides.provider),
      envProvider,
      cached.provider,
      DEFAULT_PROVIDER,
    )!,
    profileId: firstString(overrides.profileId, envProfileId, cached.profileId),
    withTools: firstBoolean(
      overrides.withTools,
      envWithTools,
      cached.withTools,
      DEFAULT_WITH_TOOLS,
    ) ?? DEFAULT_WITH_TOOLS,
    memory: firstBoolean(
      overrides.memory,
      envMemory,
      cached.memory,
      DEFAULT_MEMORY,
    ) ?? DEFAULT_MEMORY,
    heartbeatEnabled: firstBoolean(
      overrides.heartbeatEnabled,
      resolveBoolean(envHeartbeatEnabled),
      cached.heartbeatEnabled,
      DEFAULT_HEARTBEAT_ENABLED,
    ) ?? DEFAULT_HEARTBEAT_ENABLED,
    heartbeatIntervalMs:
      firstNumber(
        overrides.heartbeatIntervalMs,
        envHeartbeatIntervalMs,
        cached.heartbeatIntervalMs,
      )
      || DEFAULT_HEARTBEAT_INTERVAL_MS,
    heartbeatTargetOpenId: firstString(
      overrides.heartbeatTargetOpenId,
      envHeartbeatTargetOpenId,
      cached.heartbeatTargetOpenId,
    ),
    heartbeatSessionKey: firstString(
      overrides.heartbeatSessionKey,
      envHeartbeatSessionKey,
      cached.heartbeatSessionKey,
      DEFAULT_HEARTBEAT_SESSION_KEY,
    ),
    toolAllow: firstToolAllow(overrides.toolAllow, envToolAllow, cached.toolAllow) || DEFAULT_TOOL_ALLOW,
    toolMaxSteps: firstNumber(
      overrides.toolMaxSteps,
      envToolMaxSteps,
      cached.toolMaxSteps,
    ) || undefined,
    pairingPolicy:
      isValidPairingPolicy(overrides.pairingPolicy)
      || envPairingPolicy
      || isValidPairingPolicy(cached.pairingPolicy)
      || DEFAULT_PAIRING_POLICY,
    pairingPendingTtlMs:
      firstNumber(
        overrides.pairingPendingTtlMs,
        envPairingPendingTtlMs,
        cached.pairingPendingTtlMs,
      ) || DEFAULT_PAIRING_PENDING_TTL_MS,
    pairingPendingMax:
      firstNumber(
        overrides.pairingPendingMax,
        envPairingPendingMax,
        cached.pairingPendingMax,
      ) || DEFAULT_PAIRING_PENDING_MAX,
    pairingAllowFrom: firstToolAllow(overrides.pairingAllowFrom, envPairingAllowFrom, cached.pairingAllowFrom),
  };
}
