import fs from "node:fs/promises";
import path from "node:path";
import { resolveAuthDirectory } from "../auth/configStore.js";

const CURRENT_VERSION = 1 as const;
const GATEWAY_CONFIG_FILE = "gateway.json";
const DEFAULT_CHANNEL = "default";

export interface GatewayDefaultConfigScope {
  runtimeConfig?: Record<string, unknown>;
}

export interface GatewayChannelConfigScope {
  channelConfig?: Record<string, unknown>;
}

export interface GatewayConfigFile {
  version: 1;
  default?: GatewayDefaultConfigScope;
  channels?: Record<string, GatewayChannelConfigScope>;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

export function normalizeGatewayChannel(rawChannel: string | undefined): string {
  const trimmed = (rawChannel ?? "").trim().toLowerCase();
  if (!trimmed) {
    return DEFAULT_CHANNEL;
  }
  return trimmed.replace(/[^a-z0-9._-]+/g, "-");
}

export function isDefaultGatewayChannel(rawChannel: string | undefined): boolean {
  return normalizeGatewayChannel(rawChannel) === DEFAULT_CHANNEL;
}

export function resolveGatewayConfigPath(homeDir = process.env.HOME): string {
  const authDirectory = typeof homeDir === "string" && homeDir.trim().length > 0
    ? resolveAuthDirectory(homeDir)
    : resolveAuthDirectory();
  return path.join(authDirectory, GATEWAY_CONFIG_FILE);
}

function normalizeDefaultScope(raw: unknown): GatewayDefaultConfigScope | undefined {
  if (!isRecord(raw) || !isRecord(raw.runtimeConfig)) {
    return undefined;
  }
  const runtimeConfig = { ...raw.runtimeConfig };
  return Object.keys(runtimeConfig).length > 0 ? { runtimeConfig } : undefined;
}

function normalizeChannelScope(raw: unknown): GatewayChannelConfigScope | undefined {
  if (!isRecord(raw) || !isRecord(raw.channelConfig)) {
    return undefined;
  }
  const channelConfig = { ...raw.channelConfig };
  return Object.keys(channelConfig).length > 0 ? { channelConfig } : undefined;
}

export function normalizeGatewayConfigFile(raw: unknown): GatewayConfigFile {
  const defaultScope = normalizeDefaultScope(isRecord(raw) ? raw.default : undefined);
  const channels: Record<string, GatewayChannelConfigScope> = {};
  if (isRecord(raw) && isRecord(raw.channels)) {
    for (const [rawChannel, rawScope] of Object.entries(raw.channels)) {
      const channel = normalizeGatewayChannel(rawChannel);
      if (channel === DEFAULT_CHANNEL) {
        continue;
      }
      const scope = normalizeChannelScope(rawScope);
      if (scope) {
        channels[channel] = scope;
      }
    }
  }

  return {
    version: CURRENT_VERSION,
    ...(defaultScope ? { default: defaultScope } : {}),
    ...(Object.keys(channels).length > 0 ? { channels } : {}),
  };
}

export async function loadGatewayConfigFile(homeDir = process.env.HOME): Promise<GatewayConfigFile | null> {
  try {
    const file = await fs.readFile(resolveGatewayConfigPath(homeDir), "utf-8");
    return normalizeGatewayConfigFile(JSON.parse(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    return null;
  }
}

function hasPersistedConfig(store: GatewayConfigFile): boolean {
  return !!(
    store.default
    || (store.channels && Object.keys(store.channels).length > 0)
  );
}

export async function saveGatewayConfigFile(
  store: GatewayConfigFile,
  homeDir = process.env.HOME,
): Promise<void> {
  const normalized = normalizeGatewayConfigFile(store);
  const filePath = resolveGatewayConfigPath(homeDir);

  if (!hasPersistedConfig(normalized)) {
    try {
      await fs.unlink(filePath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(normalized, null, 2), "utf-8");
}
