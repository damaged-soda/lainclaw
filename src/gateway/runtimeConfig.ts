import { loadGatewayConfigFile, saveGatewayConfigFile } from "./configFile.js";

const DEFAULT_WITH_TOOLS = true;
const DEFAULT_MEMORY = false;

function trimText(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeProvider(raw: unknown): string | undefined {
  const trimmed = trimText(raw);
  return trimmed ? trimmed.toLowerCase() : undefined;
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
    const normalized = trimText(value);
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

export interface GatewayRuntimeConfig {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  memory?: boolean;
}

export interface GatewayRuntimeConfigSources {
  provider?: "default";
  profileId?: "default";
  withTools?: "default";
  memory?: "default";
}

export interface GatewayAgentRuntimeContext extends GatewayRuntimeConfig {
  userId?: string;
  newSession?: boolean;
  cwd?: string;
  debug?: boolean;
}

export function normalizeGatewayRuntimeConfig(
  input: GatewayRuntimeConfig | undefined,
): GatewayRuntimeConfig {
  return {
    ...(normalizeProvider(input?.provider) ? { provider: normalizeProvider(input?.provider) } : {}),
    ...(trimText(input?.profileId) ? { profileId: trimText(input?.profileId) } : {}),
    ...(typeof input?.withTools === "boolean" ? { withTools: input.withTools } : {}),
    ...(typeof input?.memory === "boolean" ? { memory: input.memory } : {}),
  };
}

function normalizeStoredGatewayRuntimeConfig(raw: unknown): Partial<GatewayRuntimeConfig> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const candidate = raw as Partial<Record<keyof GatewayRuntimeConfig, unknown>>;
  return {
    ...(normalizeProvider(candidate.provider) ? { provider: normalizeProvider(candidate.provider) } : {}),
    ...(trimText(candidate.profileId) ? { profileId: trimText(candidate.profileId) } : {}),
    ...(typeof resolveBoolean(candidate.withTools) === "boolean"
      ? { withTools: resolveBoolean(candidate.withTools) }
      : {}),
    ...(typeof resolveBoolean(candidate.memory) === "boolean"
      ? { memory: resolveBoolean(candidate.memory) }
      : {}),
  };
}

function buildRuntimeSources(
  runtimeConfig: Partial<GatewayRuntimeConfig>,
): GatewayRuntimeConfigSources {
  return {
    ...(typeof runtimeConfig.provider === "string" ? { provider: "default" as const } : {}),
    ...(typeof runtimeConfig.profileId === "string" ? { profileId: "default" as const } : {}),
    ...(typeof runtimeConfig.withTools === "boolean" ? { withTools: "default" as const } : {}),
    ...(typeof runtimeConfig.memory === "boolean" ? { memory: "default" as const } : {}),
  };
}

function filterPersistableRuntimeConfig(
  updates: Partial<GatewayRuntimeConfig>,
): Partial<GatewayRuntimeConfig> {
  return normalizeGatewayRuntimeConfig(updates as GatewayRuntimeConfig);
}

function cleanupEmptyDefaultScope(store: {
  default?: {
    runtimeConfig?: Record<string, unknown>;
  };
}): void {
  if (!store.default || Object.keys(store.default).length > 0) {
    return;
  }
  delete store.default;
}

export async function loadGatewayRuntimeConfigWithSources(): Promise<{
  runtimeConfig: Partial<GatewayRuntimeConfig>;
  sources: GatewayRuntimeConfigSources;
}> {
  const store = await loadGatewayConfigFile();
  const runtimeConfig = normalizeStoredGatewayRuntimeConfig(store?.default?.runtimeConfig);
  return {
    runtimeConfig,
    sources: buildRuntimeSources(runtimeConfig),
  };
}

export async function persistGatewayRuntimeConfig(
  updates: Partial<GatewayRuntimeConfig>,
): Promise<void> {
  const filtered = filterPersistableRuntimeConfig(updates);
  if (Object.keys(filtered).length === 0) {
    return;
  }

  const store = (await loadGatewayConfigFile()) ?? { version: 1 as const };
  const current = normalizeStoredGatewayRuntimeConfig(store.default?.runtimeConfig);
  const runtimeConfig = {
    ...current,
    ...filtered,
  };

  store.default = {
    ...(store.default ?? {}),
    ...(Object.keys(runtimeConfig).length > 0 ? { runtimeConfig } : {}),
  };
  cleanupEmptyDefaultScope(store);
  await saveGatewayConfigFile(store);
}

export async function clearGatewayRuntimeConfig(): Promise<void> {
  const store = await loadGatewayConfigFile();
  if (!store?.default) {
    return;
  }

  delete store.default.runtimeConfig;
  cleanupEmptyDefaultScope(store);
  await saveGatewayConfigFile(store);
}

export async function resolveGatewayRuntimeConfig(
  overrides: GatewayRuntimeConfig | undefined,
): Promise<GatewayRuntimeConfig> {
  const { runtimeConfig: stored } = await loadGatewayRuntimeConfigWithSources();
  const envProvider = normalizeProvider(process.env.LAINCLAW_GATEWAY_PROVIDER);
  const envProfileId = trimText(process.env.LAINCLAW_GATEWAY_PROFILE_ID);
  const envWithTools = resolveBoolean(process.env.LAINCLAW_GATEWAY_WITH_TOOLS);
  const envMemory = resolveBoolean(process.env.LAINCLAW_GATEWAY_MEMORY);

  return {
    provider: firstString(normalizeProvider(overrides?.provider), envProvider, stored.provider),
    profileId: firstString(overrides?.profileId, envProfileId, stored.profileId),
    withTools: firstBoolean(overrides?.withTools, envWithTools, stored.withTools, DEFAULT_WITH_TOOLS),
    memory: firstBoolean(overrides?.memory, envMemory, stored.memory, DEFAULT_MEMORY),
  };
}
