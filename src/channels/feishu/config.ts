import {
  isDefaultGatewayChannel,
  loadGatewayConfigFile,
  normalizeGatewayChannel,
  saveGatewayConfigFile,
} from "../../gateway/configFile.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

function resolveText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
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

export interface FeishuChannelConfig {
  appId?: string;
  appSecret?: string;
  requestTimeoutMs: number;
}

export interface FeishuChannelConfigSources {
  appId?: "channel";
  appSecret?: "channel";
  requestTimeoutMs?: "channel";
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

  return {
    ...(appId ? { appId } : {}),
    ...(appSecret ? { appSecret } : {}),
    ...(typeof requestTimeoutMs === "number" && requestTimeoutMs > 0 ? { requestTimeoutMs } : {}),
  };
}

function buildChannelSources(
  channelConfig: Partial<FeishuChannelConfig>,
): FeishuChannelConfigSources {
  return {
    ...(typeof channelConfig.appId === "string" ? { appId: "channel" as const } : {}),
    ...(typeof channelConfig.appSecret === "string" ? { appSecret: "channel" as const } : {}),
    ...(typeof channelConfig.requestTimeoutMs === "number" ? { requestTimeoutMs: "channel" as const } : {}),
  };
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

  const filtered = normalizeStoredFeishuChannelConfig(updates);
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

  return {
    appId: firstString(overrides.appId, envAppId, stored.appId),
    appSecret: firstString(overrides.appSecret, envAppSecret, stored.appSecret),
    requestTimeoutMs:
      firstNumber(overrides.requestTimeoutMs, envRequestTimeoutMs, stored.requestTimeoutMs)
      || DEFAULT_REQUEST_TIMEOUT_MS,
  };
}
