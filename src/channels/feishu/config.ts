import {
  DEFAULT_PAIRING_PENDING_MAX,
  DEFAULT_PAIRING_PENDING_TTL_MS,
  type PairingPolicy,
} from "../../pairing/contracts.js";
import {
  isDefaultGatewayChannel,
  loadGatewayConfigFile,
  normalizeGatewayChannel,
  saveGatewayConfigFile,
} from "../../gateway/configFile.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_PAIRING_POLICY = "open" as PairingPolicy;

function resolveText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function resolveBoolean(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = resolveText(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    const normalized = resolveBoolean(value);
    if (typeof normalized === "boolean") {
      return normalized;
    }
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
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

function isValidPairingPolicy(raw: unknown): PairingPolicy | undefined {
  const normalized = resolveText(raw).toLowerCase();
  if (["open", "allowlist", "pairing", "disabled"].includes(normalized)) {
    return normalized as PairingPolicy;
  }
  return undefined;
}

function parseStringListRaw(raw: string | undefined): string[] | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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
    return parseStringListRaw(raw) ?? [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  return normalizeAllowFrom(raw);
}

function normalizeStringList(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
  }
  if (typeof raw === "string") {
    return parseStringListRaw(raw);
  }
  return undefined;
}

function firstStringList(...values: unknown[]): string[] | undefined {
  for (const value of values) {
    const normalized = normalizeStringList(value);
    if (normalized !== undefined) {
      return normalized;
    }
  }
  return undefined;
}

export interface FeishuChannelConfig {
  appId?: string;
  appSecret?: string;
  requestTimeoutMs: number;
  pairingPolicy?: PairingPolicy;
  pairingPendingTtlMs?: number;
  pairingPendingMax?: number;
  pairingAllowFrom?: string[];
}

export interface FeishuChannelConfigSources {
  appId?: "channel";
  appSecret?: "channel";
  requestTimeoutMs?: "channel";
  pairingPolicy?: "channel";
  pairingPendingTtlMs?: "channel";
  pairingPendingMax?: "channel";
  pairingAllowFrom?: "channel";
}

function normalizeStoredFeishuChannelConfig(raw: unknown): Partial<FeishuChannelConfig> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const candidate = raw as Partial<Record<keyof FeishuChannelConfig, unknown>>;
  const appId = resolveText(candidate.appId);
  const appSecret = resolveText(candidate.appSecret);
  const requestTimeoutMs =
    typeof candidate.requestTimeoutMs === "number" && Number.isFinite(candidate.requestTimeoutMs)
      ? candidate.requestTimeoutMs
      : undefined;
  const pairingPolicy = isValidPairingPolicy(candidate.pairingPolicy);
  const pairingPendingTtlMs =
    typeof candidate.pairingPendingTtlMs === "number" && Number.isFinite(candidate.pairingPendingTtlMs)
      ? candidate.pairingPendingTtlMs
      : undefined;
  const pairingPendingMax =
    typeof candidate.pairingPendingMax === "number" && Number.isFinite(candidate.pairingPendingMax)
      ? candidate.pairingPendingMax
      : undefined;
  const pairingAllowFrom = normalizeAllowFromRaw(candidate.pairingAllowFrom);

  return {
    ...(appId ? { appId } : {}),
    ...(appSecret ? { appSecret } : {}),
    ...(typeof requestTimeoutMs === "number" && requestTimeoutMs > 0 ? { requestTimeoutMs } : {}),
    ...(pairingPolicy ? { pairingPolicy } : {}),
    ...(typeof pairingPendingTtlMs === "number" && pairingPendingTtlMs > 0 ? { pairingPendingTtlMs } : {}),
    ...(typeof pairingPendingMax === "number" && pairingPendingMax > 0 ? { pairingPendingMax } : {}),
    ...(pairingAllowFrom.length > 0 ? { pairingAllowFrom } : {}),
  };
}

function buildChannelSources(
  channelConfig: Partial<FeishuChannelConfig>,
): FeishuChannelConfigSources {
  return {
    ...(typeof channelConfig.appId === "string" ? { appId: "channel" as const } : {}),
    ...(typeof channelConfig.appSecret === "string" ? { appSecret: "channel" as const } : {}),
    ...(typeof channelConfig.requestTimeoutMs === "number" ? { requestTimeoutMs: "channel" as const } : {}),
    ...(typeof channelConfig.pairingPolicy === "string" ? { pairingPolicy: "channel" as const } : {}),
    ...(typeof channelConfig.pairingPendingTtlMs === "number"
      ? { pairingPendingTtlMs: "channel" as const }
      : {}),
    ...(typeof channelConfig.pairingPendingMax === "number" ? { pairingPendingMax: "channel" as const } : {}),
    ...(Array.isArray(channelConfig.pairingAllowFrom) ? { pairingAllowFrom: "channel" as const } : {}),
  };
}

function filterPersistableChannelConfig(
  updates: Partial<FeishuChannelConfig>,
): Partial<FeishuChannelConfig> {
  return normalizeStoredFeishuChannelConfig(updates);
}

function cleanupEmptyChannelScope(store: {
  channels?: Record<string, { channelConfig?: Record<string, unknown> }>;
}, channel: string): void {
  const scope = store.channels?.[channel];
  if (scope && Object.keys(scope).length === 0) {
    delete store.channels?.[channel];
  }
  if (store.channels && Object.keys(store.channels).length === 0) {
    delete store.channels;
  }
}

export async function loadFeishuChannelConfigWithSources(
  channel = "feishu",
): Promise<{ channelConfig: Partial<FeishuChannelConfig>; sources: FeishuChannelConfigSources }> {
  const normalizedChannel = normalizeGatewayChannel(channel);
  const store = await loadGatewayConfigFile();
  const channelConfig = normalizeStoredFeishuChannelConfig(store?.channels?.[normalizedChannel]?.channelConfig);
  return {
    channelConfig,
    sources: buildChannelSources(channelConfig),
  };
}

export async function persistFeishuChannelConfig(
  updates: Partial<FeishuChannelConfig>,
  channel = "feishu",
): Promise<void> {
  const normalizedChannel = normalizeGatewayChannel(channel);
  if (isDefaultGatewayChannel(normalizedChannel)) {
    throw new Error("channel config requires a concrete gateway channel");
  }

  const filtered = filterPersistableChannelConfig(updates);
  if (Object.keys(filtered).length === 0) {
    return;
  }

  const store = (await loadGatewayConfigFile()) ?? { version: 1 as const };
  const current = normalizeStoredFeishuChannelConfig(store.channels?.[normalizedChannel]?.channelConfig);
  const channelConfig = {
    ...current,
    ...filtered,
  };

  store.channels = {
    ...(store.channels ?? {}),
    [normalizedChannel]: {
      channelConfig,
    },
  };
  await saveGatewayConfigFile(store);
}

export async function clearFeishuChannelConfig(channel = "feishu"): Promise<void> {
  const normalizedChannel = normalizeGatewayChannel(channel);
  if (isDefaultGatewayChannel(normalizedChannel)) {
    return;
  }

  const store = await loadGatewayConfigFile();
  if (!store?.channels?.[normalizedChannel]) {
    return;
  }

  delete store.channels[normalizedChannel];
  cleanupEmptyChannelScope(store, normalizedChannel);
  await saveGatewayConfigFile(store);
}

export async function resolveFeishuChannelConfig(
  overrides: Partial<FeishuChannelConfig> = {},
  channel = "feishu",
): Promise<FeishuChannelConfig> {
  const { channelConfig: stored } = await loadFeishuChannelConfigWithSources(channel);

  const envAppId = resolveText(process.env.LAINCLAW_FEISHU_APP_ID || process.env.FEISHU_APP_ID);
  const envAppSecret = resolveText(process.env.LAINCLAW_FEISHU_APP_SECRET || process.env.FEISHU_APP_SECRET);
  const envRequestTimeoutMs = resolveText(
    process.env.LAINCLAW_FEISHU_REQUEST_TIMEOUT_MS || process.env.FEISHU_REQUEST_TIMEOUT_MS,
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
  const envPairingAllowFrom = parseStringListRaw(
    process.env.LAINCLAW_FEISHU_PAIRING_ALLOW_FROM || process.env.FEISHU_PAIRING_ALLOW_FROM,
  );

  return {
    appId: firstString(overrides.appId, envAppId, stored.appId),
    appSecret: firstString(overrides.appSecret, envAppSecret, stored.appSecret),
    requestTimeoutMs:
      firstNumber(overrides.requestTimeoutMs, envRequestTimeoutMs, stored.requestTimeoutMs)
      || DEFAULT_REQUEST_TIMEOUT_MS,
    pairingPolicy:
      isValidPairingPolicy(overrides.pairingPolicy)
      || envPairingPolicy
      || isValidPairingPolicy(stored.pairingPolicy)
      || DEFAULT_PAIRING_POLICY,
    pairingPendingTtlMs:
      firstNumber(
        overrides.pairingPendingTtlMs,
        envPairingPendingTtlMs,
        stored.pairingPendingTtlMs,
      ) || DEFAULT_PAIRING_PENDING_TTL_MS,
    pairingPendingMax:
      firstNumber(
        overrides.pairingPendingMax,
        envPairingPendingMax,
        stored.pairingPendingMax,
      ) || DEFAULT_PAIRING_PENDING_MAX,
    pairingAllowFrom: firstStringList(overrides.pairingAllowFrom, envPairingAllowFrom, stored.pairingAllowFrom),
  };
}
