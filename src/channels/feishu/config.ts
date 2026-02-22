import fs from "node:fs/promises";
import path from "node:path";
import { resolveAuthDirectory } from "../../auth/configStore.js";

export interface FeishuGatewayConfig {
  appId?: string;
  appSecret?: string;
  requestTimeoutMs: number;
}

interface FeishuGatewayStorage {
  version: 1;
  config: {
    appId?: string;
    appSecret?: string;
    requestTimeoutMs?: number;
  };
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const FEISHU_GATEWAY_CONFIG_FILE = "feishu-gateway.json";
const CURRENT_VERSION = 1 as const;

function resolveText(raw: string | undefined): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim();
}

function resolveConfigPath(): string {
  return path.join(resolveAuthDirectory(), FEISHU_GATEWAY_CONFIG_FILE);
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

  const normalized: Partial<FeishuGatewayConfig> = {};
  if (appId) {
    normalized.appId = appId;
  }
  if (appSecret) {
    normalized.appSecret = appSecret;
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

export async function loadCachedFeishuGatewayConfig(): Promise<Partial<FeishuGatewayConfig>> {
  try {
    const file = await fs.readFile(resolveConfigPath(), "utf-8");
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
  };
}

export async function persistFeishuGatewayConfig(updates: Partial<FeishuGatewayConfig>): Promise<void> {
  const filtered = filterPersistable(updates);
  if (Object.keys(filtered).length === 0) {
    return;
  }

  const cached = await loadCachedFeishuGatewayConfig();
  const next: FeishuGatewayStorage = {
    version: CURRENT_VERSION,
    config: {
      ...cached,
      ...filtered,
    },
  };
  await fs.mkdir(resolveAuthDirectory(), { recursive: true });
  await fs.writeFile(resolveConfigPath(), JSON.stringify(next, null, 2), "utf-8");
}

export async function resolveFeishuGatewayConfig(
  overrides: Partial<FeishuGatewayConfig> = {},
): Promise<FeishuGatewayConfig> {
  const cached = await loadCachedFeishuGatewayConfig();

  const envAppId = resolveText(process.env.LAINCLAW_FEISHU_APP_ID || process.env.FEISHU_APP_ID);
  const envAppSecret = resolveText(process.env.LAINCLAW_FEISHU_APP_SECRET || process.env.FEISHU_APP_SECRET);
  const envRequestTimeoutMs = resolveText(
    process.env.LAINCLAW_FEISHU_REQUEST_TIMEOUT_MS || process.env.FEISHU_REQUEST_TIMEOUT_MS,
  );

  return {
    appId: firstString(overrides.appId, cached.appId, envAppId),
    appSecret: firstString(overrides.appSecret, cached.appSecret, envAppSecret),
    requestTimeoutMs:
      firstNumber(overrides.requestTimeoutMs, cached.requestTimeoutMs, envRequestTimeoutMs) ||
      DEFAULT_REQUEST_TIMEOUT_MS,
  };
}
