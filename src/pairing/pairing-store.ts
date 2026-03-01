import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveAuthDirectory } from "../auth/configStore.js";

export const DEFAULT_PAIRING_PENDING_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_PAIRING_PENDING_MAX = 3;

const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CURRENT_VERSION = 1 as const;

export type PairingChannel = string;
export type PairingPolicy = "open" | "allowlist" | "pairing" | "disabled";

export type PairingStoreLimits = {
  ttlMs?: number;
  maxPending?: number;
};

export interface PairingRequest {
  id: string;
  code: string;
  createdAt: string;
  lastSeenAt: string;
  meta?: Record<string, string>;
}

interface GatewayPairingChannelState {
  requests?: PairingRequest[];
  allowFrom?: string[];
  accountAllowFrom?: Record<string, string[]>;
}

interface GatewayPairingState {
  version: 1;
  channels?: Record<string, GatewayPairingChannelState>;
}

interface GatewayConfigFile {
  [key: string]: unknown;
  version?: number;
  pairing?: GatewayPairingState;
}

function safeChannelKey(channel: PairingChannel): string {
  const raw = String(channel).trim().toLowerCase();
  if (!raw) {
    throw new Error("invalid pairing channel");
  }
  const safe = raw.replace(/[\\/:*?\"<>|]/g, "_").replace(/\.\./g, "_");
  if (!safe || safe === "_") {
    throw new Error("invalid pairing channel");
  }
  return safe;
}

function resolveGatewayConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveAuthDirectory(env.HOME), GATEWAY_CONFIG_FILE);
}

const GATEWAY_CONFIG_FILE = "gateway.json";

const storeLocks = new Map<string, Promise<void>>();

const DEFAULT_GATEWAY_CONFIG_FILE: GatewayConfigFile = {
  version: CURRENT_VERSION,
  pairing: {
    version: CURRENT_VERSION,
    channels: {},
  },
};

function hasPairingChannelData(state: GatewayPairingChannelState): boolean {
  return (
    (state.requests?.length ?? 0) > 0
    || (state.allowFrom?.length ?? 0) > 0
    || Object.keys(state.accountAllowFrom ?? {}).length > 0
  );
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

async function withStoreLock<T>(filePath: string, fallback: unknown, fn: () => Promise<T>): Promise<T> {
  await ensureJsonFile(filePath, fallback);
  const previous = storeLocks.get(filePath) || Promise.resolve();
  let release: () => void = () => {};
  const releaseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const nextTail = previous.then(() => releaseGate);
  storeLocks.set(filePath, nextTail);

  try {
    await previous;
    return await fn();
  } finally {
    release();
    if (storeLocks.get(filePath) === nextTail) {
      storeLocks.delete(filePath);
    }
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<{ value: T }> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return { value: parsed as T };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { value: fallback };
    }
    return { value: fallback };
  }
}

function trimText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function normalizeGatewayPairingState(raw: unknown): GatewayPairingState {
  if (!isRecord(raw)) {
    return {
      version: CURRENT_VERSION,
      channels: {},
    };
  }
  const candidate = raw as Partial<GatewayPairingState>;
  if (!Number.isInteger(candidate.version) || candidate.version !== CURRENT_VERSION) {
    return {
      version: CURRENT_VERSION,
      channels: {},
    };
  }
  const channelsSource = isRecord(candidate.channels) ? candidate.channels : {};
  const normalizedChannels: Record<string, GatewayPairingChannelState> = {};
  for (const [rawChannel, rawScope] of Object.entries(channelsSource)) {
    const normalizedScope = normalizeGatewayPairingChannelState(rawScope);
    if (hasPairingChannelData(normalizedScope)) {
      normalizedChannels[rawChannel] = normalizedScope;
    }
  }
  return {
    version: CURRENT_VERSION,
    channels: normalizedChannels,
  };
}

function normalizeGatewayConfigFile(raw: unknown): GatewayConfigFile {
  if (!isRecord(raw)) {
    return { ...DEFAULT_GATEWAY_CONFIG_FILE };
  }
  const parsed = raw as GatewayConfigFile;
  const version = Number.isFinite(parsed.version as number) ? parsed.version : CURRENT_VERSION;
  return {
    ...parsed,
    version,
    pairing: normalizeGatewayPairingState(parsed.pairing),
  };
}

async function readGatewayConfigFile(filePath: string): Promise<GatewayConfigFile> {
  const parsed = await readJsonFile(filePath, DEFAULT_GATEWAY_CONFIG_FILE);
  return normalizeGatewayConfigFile(parsed.value);
}

async function writeGatewayConfigFile(filePath: string, value: GatewayConfigFile): Promise<void> {
  const normalized = normalizeGatewayConfigFile(value);
  await writeJsonFile(filePath, normalized);
}

function normalizePairingRequestList(raw: unknown): PairingRequest[] {
  const candidate = isRecord(raw) ? raw.requests : raw;
  const requests = Array.isArray(candidate) ? candidate : [];
  const normalized: PairingRequest[] = [];

  for (const candidate of requests) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const asRecord = candidate as unknown as Record<string, unknown>;
    const id = trimText(asRecord.id);
    const code = trimText(asRecord.code);
    const createdAt = trimText(asRecord.createdAt);
    const lastSeenAt = trimText(asRecord.lastSeenAt);
    if (!id || !code || !createdAt || !lastSeenAt) {
      continue;
    }

    const metaCandidate = asRecord.meta;
    const metaEntries =
      metaCandidate && typeof metaCandidate === "object"
        ? Object.entries(metaCandidate as Record<string, unknown>)
        : [];
    const meta = Object.fromEntries(
      metaEntries
        .map(([k, v]) => [k, trimText(v)] as const)
        .filter(([_, v]) => Boolean(v)),
    );

    normalized.push({
      id,
      code,
      createdAt,
      lastSeenAt,
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    });
  }

  return normalized;
}

function normalizeGatewayPairingChannelState(raw: unknown): GatewayPairingChannelState {
  if (!isRecord(raw)) {
    return { requests: [] };
  }
  const candidate = raw as Partial<GatewayPairingChannelState>;
  const requests = normalizePairingRequestList(candidate.requests);
  const allowFrom = normalizeAndDedup(Array.isArray(candidate.allowFrom) ? candidate.allowFrom : []);
  const rawAccountMap = isRecord(candidate.accountAllowFrom) ? candidate.accountAllowFrom : {};
  const accountAllowFrom: Record<string, string[]> = {};
  for (const [accountId, rawEntries] of Object.entries(rawAccountMap)) {
    const normalizedAccountId = normalizePairingAccountId(accountId);
    if (!normalizedAccountId) {
      continue;
    }
    const normalizedEntries = normalizeAndDedup(Array.isArray(rawEntries) ? rawEntries : []);
    if (normalizedEntries.length > 0) {
      accountAllowFrom[normalizedAccountId] = normalizedEntries;
    }
  }

  return {
    ...(requests.length > 0 ? { requests } : { requests: [] }),
    ...(allowFrom.length > 0 ? { allowFrom } : {}),
    ...(Object.keys(accountAllowFrom).length > 0 ? { accountAllowFrom } : {}),
  };
}

function normalizePairingAccountId(accountId?: string): string {
  return trimText(accountId).toLowerCase();
}

function resolvePendingLimits(params: PairingStoreLimits | undefined): { ttlMs: number; maxPending: number } {
  const ttlMs = Number.isFinite(params?.ttlMs as number) && (params?.ttlMs ?? 0) > 0
    ? Math.floor((params as PairingStoreLimits).ttlMs as number)
    : DEFAULT_PAIRING_PENDING_TTL_MS;
  const maxPending = Number.isFinite(params?.maxPending as number) && (params?.maxPending ?? 0) > 0
    ? Math.floor((params as PairingStoreLimits).maxPending as number)
    : DEFAULT_PAIRING_PENDING_MAX;
  return { ttlMs, maxPending };
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.tmp-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), { encoding: "utf-8", mode: 0o600 });
  await fs.rename(tmpPath, filePath);
}

async function ensureJsonFile(filePath: string, fallback: unknown): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await writeJsonFile(filePath, fallback);
  }
}

async function readPairingChannelState(
  filePath: string,
  channel: PairingChannel,
): Promise<GatewayPairingChannelState> {
  const gateway = await readGatewayConfigFile(filePath);
  const pairing = normalizeGatewayPairingState(gateway.pairing);
  const channelState = pairing.channels?.[safeChannelKey(channel)];
  return normalizeGatewayPairingChannelState(channelState);
}

async function writePairingChannelState(
  filePath: string,
  channel: PairingChannel,
  state: GatewayPairingChannelState,
): Promise<void> {
  const gateway = await readGatewayConfigFile(filePath);
  const pairing = normalizeGatewayPairingState(gateway.pairing);
  const channels: Record<string, GatewayPairingChannelState> = { ...(pairing.channels ?? {}) };
  const safeChannel = safeChannelKey(channel);
  const normalizedAccountAllowFrom: Record<string, string[]> = {};
  for (const [accountId, rawEntries] of Object.entries(state.accountAllowFrom ?? {})) {
    const normalizedAccountId = normalizePairingAccountId(accountId);
    if (!normalizedAccountId) {
      continue;
    }
    const normalizedEntries = normalizeAndDedup(Array.isArray(rawEntries) ? rawEntries : []);
    if (normalizedEntries.length > 0) {
      normalizedAccountAllowFrom[normalizedAccountId] = normalizedEntries;
    }
  }
  const nextState = {
    requests: normalizePairingRequestList(state.requests),
    ...(state.allowFrom && normalizeAndDedup(state.allowFrom).length > 0 ? { allowFrom: normalizeAndDedup(state.allowFrom) } : {}),
    ...(Object.keys(normalizedAccountAllowFrom).length > 0 ? { accountAllowFrom: normalizedAccountAllowFrom } : {}),
  };
  if (hasPairingChannelData(nextState)) {
    channels[safeChannel] = nextState;
  } else {
    delete channels[safeChannel];
  }
  await writeGatewayConfigFile(filePath, {
    ...gateway,
    pairing: {
      version: CURRENT_VERSION,
      ...(Object.keys(channels).length > 0 ? { channels } : {}),
    },
  });
}

function parseTimestamp(raw: string): number {
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : 0;
}

function isExpired(entry: PairingRequest, nowMs: number, ttlMs: number): boolean {
  const createdAtMs = parseTimestamp(entry.createdAt);
  if (!createdAtMs) {
    return true;
  }
  return nowMs - createdAtMs > ttlMs;
}

function pruneExpiredRequests(requests: PairingRequest[], nowMs: number, ttlMs: number) {
  const kept: PairingRequest[] = [];
  let removed = false;
  for (const entry of requests) {
    if (isExpired(entry, nowMs, ttlMs)) {
      removed = true;
      continue;
    }
    kept.push(entry);
  }
  return { requests: kept, removed };
}

function pruneExcessRequests(requests: PairingRequest[], maxPending: number) {
  if (maxPending <= 0 || requests.length <= maxPending) {
    return { requests, removed: false };
  }
  const sorted = requests.slice().sort((a, b) => parseTimestamp(a.lastSeenAt) - parseTimestamp(b.lastSeenAt));
  return { requests: sorted.slice(-maxPending), removed: true };
}

function randomCode(): string {
  let out = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    const idx = crypto.randomInt(0, PAIRING_CODE_ALPHABET.length);
    out += PAIRING_CODE_ALPHABET[idx];
  }
  return out;
}

function generateUniqueCode(existing: Set<string>): string {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const code = randomCode();
    if (!existing.has(code)) {
      return code;
    }
  }
  throw new Error("failed to generate unique pairing code");
}

function normalizePairingCode(raw: string | undefined): string {
  return trimText(raw).toUpperCase();
}

function normalizeAllowFromEntry(raw: string | number | undefined): string {
  return trimText(String(raw)).toLowerCase();
}

function requestMatchesAccountId(entry: PairingRequest, normalizedAccountId: string): boolean {
  if (!normalizedAccountId) {
    return true;
  }
  return (entry.meta?.accountId ?? "").trim().toLowerCase() === normalizedAccountId;
}

function normalizeAndDedup(entries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    const normalized = trimText(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

async function readAllowFromState(
  filePath: string,
  channel: PairingChannel,
  accountId?: string,
): Promise<string[]> {
  const pairing = await readPairingChannelState(filePath, channel);
  if (!accountId) {
    return normalizeAndDedup(pairing.allowFrom ?? []);
  }
  const normalizedAccountId = normalizePairingAccountId(accountId);
  if (!normalizedAccountId) {
    return [];
  }
  return normalizeAndDedup(pairing.accountAllowFrom?.[normalizedAccountId] ?? []);
}

async function writeAllowFromState(
  filePath: string,
  channel: PairingChannel,
  nextAllowFrom: string[],
  accountId?: string,
): Promise<void> {
  const normalizedAccountId = accountId ? normalizePairingAccountId(accountId) || undefined : undefined;
  const pairing = await readPairingChannelState(filePath, channel);
  const nextState: GatewayPairingChannelState = {
    ...pairing,
    ...(accountId ? {} : { allowFrom: normalizeAndDedup(nextAllowFrom) }),
  };

  if (accountId && normalizedAccountId) {
    const accountAllowFrom = {
      ...(pairing.accountAllowFrom ?? {}),
    };
    if (nextAllowFrom.length > 0) {
      accountAllowFrom[normalizedAccountId] = normalizeAndDedup(nextAllowFrom);
    } else {
      delete accountAllowFrom[normalizedAccountId];
      if (Object.keys(accountAllowFrom).length === 0) {
        delete nextState.accountAllowFrom;
      }
    }
    nextState.accountAllowFrom = Object.keys(accountAllowFrom).length > 0 ? accountAllowFrom : {};
  }

  await writePairingChannelState(filePath, channel, nextState);
}

async function updateAllowFromStoreEntry(
  params: {
    channel: PairingChannel;
    entry: string | number;
    accountId?: string;
    env?: NodeJS.ProcessEnv;
    apply: (current: string[], normalized: string) => string[] | null;
  },
): Promise<{ changed: boolean; allowFrom: string[] }> {
  const env = params.env ?? process.env;
  const filePath = resolveGatewayConfigPath(env);
  const normalizedAccountId = params.accountId
    ? normalizePairingAccountId(params.accountId) || undefined
    : undefined;
  return withStoreLock(filePath, DEFAULT_GATEWAY_CONFIG_FILE, async () => {
    const current = normalizeAndDedup(await readAllowFromState(filePath, params.channel, normalizedAccountId));
    const normalized = normalizeAllowFromEntry(params.entry);
    if (!normalized) {
      return { changed: false, allowFrom: current };
    }
    const next = params.apply(current, normalized);
    if (!next) {
      return { changed: false, allowFrom: current };
    }
    const uniqueNext = normalizeAndDedup(next);
    await writeAllowFromState(filePath, params.channel, uniqueNext, normalizedAccountId);
    return { changed: true, allowFrom: uniqueNext };
  });
}

export async function readChannelAllowFromStore(
  channel: PairingChannel,
  env: NodeJS.ProcessEnv = process.env,
  accountId?: string,
): Promise<string[]> {
  const filePath = resolveGatewayConfigPath(env);
  const normalizedAccountId = normalizePairingAccountId(accountId);
  if (!normalizedAccountId) {
    return readAllowFromState(filePath, channel);
  }

  const scopedEntries = await readAllowFromState(filePath, channel, normalizedAccountId);
  const legacyEntries = await readAllowFromState(filePath, channel);
  return normalizeAndDedup([...scopedEntries, ...legacyEntries]);
}

export async function addChannelAllowFromStoreEntry(params: {
  channel: PairingChannel;
  entry: string | number;
  accountId?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ changed: boolean; allowFrom: string[] }> {
  return updateAllowFromStoreEntry({
    ...params,
    apply: (current, normalized) => {
      if (current.includes(normalized)) {
        return null;
      }
      return [...current, normalized];
    },
  });
}

export async function removeChannelAllowFromStoreEntry(params: {
  channel: PairingChannel;
  entry: string | number;
  accountId?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ changed: boolean; allowFrom: string[] }> {
  return updateAllowFromStoreEntry({
    ...params,
    apply: (current, normalized) => {
      const next = current.filter((entry) => entry !== normalized);
      if (next.length === current.length) {
        return null;
      }
      return next;
    },
  });
}

export async function listChannelPairingRequests(
  channel: PairingChannel,
  env: NodeJS.ProcessEnv = process.env,
  accountId?: string,
  limits?: PairingStoreLimits,
): Promise<PairingRequest[]> {
  const filePath = resolveGatewayConfigPath(env);
  const { ttlMs, maxPending } = resolvePendingLimits(limits);
  return withStoreLock(filePath, DEFAULT_GATEWAY_CONFIG_FILE, async () => {
    const nowMs = Date.now();
    const currentState = await readPairingChannelState(filePath, channel);
    const reqs = currentState.requests ?? [];
    const { requests: prunedExpired, removed: expiredRemoved } = pruneExpiredRequests(reqs, nowMs, ttlMs);
    const { requests: pruned, removed: cappedRemoved } = pruneExcessRequests(prunedExpired, maxPending);

    if (expiredRemoved || cappedRemoved) {
      await writePairingChannelState(filePath, channel, {
        ...currentState,
        requests: pruned,
      });
    }

    const normalizedAccountId = normalizePairingAccountId(accountId);
    const filtered = normalizedAccountId
      ? pruned.filter((entry) => requestMatchesAccountId(entry, normalizedAccountId))
      : pruned;

    return filtered
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  });
}

export async function upsertChannelPairingRequest(params: {
  channel: PairingChannel;
  id: string | number;
  accountId?: string;
  meta?: Record<string, string | undefined | null>;
  env?: NodeJS.ProcessEnv;
  limits?: PairingStoreLimits;
}): Promise<{ code: string; created: boolean }> {
  const env = params.env ?? process.env;
  const filePath = resolveGatewayConfigPath(env);
  const id = trimText(params.id);
  if (!id) {
    throw new Error("invalid pairing sender id");
  }
  const { ttlMs, maxPending } = resolvePendingLimits(params.limits);

  return withStoreLock(filePath, DEFAULT_GATEWAY_CONFIG_FILE, async () => {
    const now = new Date().toISOString();
    const nowMs = Date.now();
    const normalizedAccountId = normalizePairingAccountId(params.accountId);
    const baseMeta = params.meta && typeof params.meta === "object"
      ? Object.fromEntries(
          Object.entries(params.meta)
            .map(([key, value]) => [key, trimText(value)] as const)
            .filter(([_, value]) => Boolean(value)),
        )
      : {};
    const meta = normalizedAccountId ? { ...baseMeta, accountId: normalizedAccountId } : baseMeta;

    const currentState = await readPairingChannelState(filePath, params.channel);
    let reqs = currentState.requests ?? [];
    const { requests: prunedExpired, removed: expiredRemoved } = pruneExpiredRequests(reqs, nowMs, ttlMs);
    reqs = prunedExpired;

    const existingIdx = reqs.findIndex(
      (entry) => entry.id === id && requestMatchesAccountId(entry, normalizedAccountId),
    );
    const existingCodes = new Set(reqs.map((entry) => normalizePairingCode(entry.code)).filter(Boolean));

    if (existingIdx >= 0) {
      const existing = reqs[existingIdx];
      const existingCode = normalizePairingCode(existing?.code);
      const code = existingCode || generateUniqueCode(existingCodes);
      const existingMeta = existing?.meta ?? {};
      reqs[existingIdx] = {
        id,
        code,
        createdAt: existing?.createdAt || now,
        lastSeenAt: now,
        ...(Object.keys({ ...existingMeta, ...meta }).length > 0
          ? { meta: { ...existingMeta, ...meta } }
          : {}),
      };
      const { requests: capped } = pruneExcessRequests(reqs, maxPending);
      await writePairingChannelState(filePath, params.channel, {
        ...currentState,
        requests: capped,
      });
      return { code, created: false };
    }

    const { requests: capped, removed: cappedRemoved } = pruneExcessRequests(reqs, maxPending);
    reqs = capped;

    if (maxPending > 0 && reqs.length >= maxPending) {
      if (expiredRemoved || cappedRemoved) {
        await writePairingChannelState(filePath, params.channel, {
          ...currentState,
          requests: reqs,
        });
      }
      return { code: "", created: false };
    }

    const code = generateUniqueCode(existingCodes);
    const next: PairingRequest = {
      id,
      code,
      createdAt: now,
      lastSeenAt: now,
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    };
    await writePairingChannelState(filePath, params.channel, {
      ...currentState,
      requests: [...reqs, next],
    });
    return { code, created: true };
  });
}

export async function approveChannelPairingCode(params: {
  channel: PairingChannel;
  code: string;
  accountId?: string;
  env?: NodeJS.ProcessEnv;
  limits?: PairingStoreLimits;
}): Promise<{ id: string; entry?: PairingRequest } | null> {
  const env = params.env ?? process.env;
  const code = normalizePairingCode(params.code);
  if (!code) {
    return null;
  }

  const filePath = resolveGatewayConfigPath(env);
  const { ttlMs } = resolvePendingLimits(params.limits);

  return withStoreLock(filePath, DEFAULT_GATEWAY_CONFIG_FILE, async () => {
    const nowMs = Date.now();
    const currentState = await readPairingChannelState(filePath, params.channel);
    const reqs = currentState.requests ?? [];
    const { requests: pruned, removed } = pruneExpiredRequests(reqs, nowMs, ttlMs);
    const normalizedAccountId = normalizePairingAccountId(params.accountId);

    const idx = pruned.findIndex(
      (entry) => normalizePairingCode(entry.code) === code && requestMatchesAccountId(entry, normalizedAccountId),
    );
    if (idx < 0) {
      if (removed) {
        await writePairingChannelState(filePath, params.channel, {
          ...currentState,
          requests: pruned,
        });
      }
      return null;
    }

    const entry = pruned[idx];
    if (!entry) {
      return null;
    }
    pruned.splice(idx, 1);
    const accountId = normalizePairingAccountId(params.accountId)
      || (entry.meta?.accountId ? entry.meta.accountId : undefined);
    const nextState: GatewayPairingChannelState = {
      ...currentState,
      requests: pruned,
    };
    const normalizedEntry = normalizeAllowFromEntry(entry.id);
    if (accountId && normalizedEntry) {
      const normalizedScopedAccountId = normalizePairingAccountId(accountId);
      const allowFromByAccount = {
        ...(currentState.accountAllowFrom ?? {}),
      };
      const nextScoped = normalizeAndDedup([
        ...(allowFromByAccount[normalizedScopedAccountId] ?? []),
        normalizedEntry,
      ]);
      if (nextScoped.length > 0) {
        allowFromByAccount[normalizedScopedAccountId] = nextScoped;
      } else {
        delete allowFromByAccount[normalizedScopedAccountId];
      }
      nextState.accountAllowFrom = allowFromByAccount;
    } else if (normalizedEntry) {
      nextState.allowFrom = normalizeAndDedup([...(currentState.allowFrom ?? []), normalizedEntry]);
    }

    await writePairingChannelState(filePath, params.channel, nextState);

    return { id: entry.id, entry };
  });
}
