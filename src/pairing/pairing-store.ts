import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveAuthDirectory } from "../auth/configStore.js";

export const DEFAULT_PAIRING_PENDING_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_PAIRING_PENDING_MAX = 3;

const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CURRENT_VERSION = 1 as const;

export type PairingChannel = "feishu";
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

interface PairingStore {
  version: 1;
  requests: PairingRequest[];
}

interface AllowFromStore {
  version: 1;
  allowFrom: string[];
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

function safeAccountKey(accountId: string): string {
  const raw = String(accountId).trim().toLowerCase();
  if (!raw) {
    throw new Error("invalid pairing account id");
  }
  const safe = raw.replace(/[\\/:*?\"<>|]/g, "_").replace(/\.\./g, "_");
  if (!safe || safe === "_") {
    throw new Error("invalid pairing account id");
  }
  return safe;
}

function resolvePairingPath(channel: PairingChannel, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveAuthDirectory(env.HOME), `${safeChannelKey(channel)}-pairing.json`);
}

function resolveAllowFromPath(channel: PairingChannel, env: NodeJS.ProcessEnv = process.env, accountId?: string): string {
  const base = safeChannelKey(channel);
  const normalizedAccountId = String(accountId || "").trim();
  if (!normalizedAccountId) {
    return path.join(resolveAuthDirectory(env.HOME), `${base}-allowFrom.json`);
  }
  return path.join(resolveAuthDirectory(env.HOME), `${base}-${safeAccountKey(normalizedAccountId)}-allowFrom.json`);
}

const storeLocks = new Map<string, Promise<void>>();

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

function normalizePairingStore(raw: unknown): PairingStore {
  const parsed = raw as Partial<PairingStore>;
  const requests = Array.isArray(parsed?.requests) ? parsed.requests : [];
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

  return { version: CURRENT_VERSION, requests: normalized };
}

function normalizeAllowFromStore(raw: unknown): AllowFromStore {
  const parsed = raw as Partial<AllowFromStore>;
  const allowFrom = Array.isArray(parsed?.allowFrom) ? parsed.allowFrom : [];
  return {
    version: CURRENT_VERSION,
    allowFrom: allowFrom.map(trimText).filter(Boolean),
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

async function readPairingRequests(filePath: string): Promise<PairingRequest[]> {
  const fallback: PairingStore = {
    version: CURRENT_VERSION,
    requests: [],
  };
  const parsed = await readJsonFile(filePath, fallback);
  const normalized = normalizePairingStore(parsed.value);
  if (!normalized.version) {
    return [];
  }
  return normalized.requests;
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

function readAllowFromState(filePath: string): Promise<string[]> {
  const fallback: AllowFromStore = { version: CURRENT_VERSION, allowFrom: [] };
  return readJsonFile(filePath, fallback).then(({ value }) => normalizeAllowFromStore(value).allowFrom);
}

async function writeAllowFromState(filePath: string, allowFrom: string[]): Promise<void> {
  await writeJsonFile(filePath, {
    version: CURRENT_VERSION,
    allowFrom,
  } satisfies AllowFromStore);
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
  const filePath = resolveAllowFromPath(params.channel, env, params.accountId);
  return withStoreLock(filePath, { version: CURRENT_VERSION, allowFrom: [] } satisfies AllowFromStore, async () => {
    const current = normalizeAndDedup(await readAllowFromState(filePath));
    const normalized = normalizeAllowFromEntry(params.entry);
    if (!normalized) {
      return { changed: false, allowFrom: current };
    }
    const next = params.apply(current, normalized);
    if (!next) {
      return { changed: false, allowFrom: current };
    }
    const uniqueNext = normalizeAndDedup(next);
    await writeAllowFromState(filePath, uniqueNext);
    return { changed: true, allowFrom: uniqueNext };
  });
}

export async function readChannelAllowFromStore(
  channel: PairingChannel,
  env: NodeJS.ProcessEnv = process.env,
  accountId?: string,
): Promise<string[]> {
  const normalizedAccountId = normalizePairingAccountId(accountId);
  if (!normalizedAccountId) {
    return readAllowFromState(resolveAllowFromPath(channel, env));
  }

  const scopedEntries = await readAllowFromState(resolveAllowFromPath(channel, env, normalizedAccountId));
  const legacyEntries = await readAllowFromState(resolveAllowFromPath(channel, env));
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
  const filePath = resolvePairingPath(channel, env);
  const { ttlMs, maxPending } = resolvePendingLimits(limits);
  return withStoreLock(filePath, { version: CURRENT_VERSION, requests: [] } satisfies PairingStore, async () => {
    const nowMs = Date.now();
    const reqs = await readPairingRequests(filePath);
    const { requests: prunedExpired, removed: expiredRemoved } = pruneExpiredRequests(reqs, nowMs, ttlMs);
    const { requests: pruned, removed: cappedRemoved } = pruneExcessRequests(prunedExpired, maxPending);

    if (expiredRemoved || cappedRemoved) {
      await writeJsonFile(filePath, {
        version: CURRENT_VERSION,
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
  const filePath = resolvePairingPath(params.channel, env);
  const id = trimText(params.id);
  if (!id) {
    throw new Error("invalid pairing sender id");
  }
  const { ttlMs, maxPending } = resolvePendingLimits(params.limits);

  return withStoreLock(filePath, { version: CURRENT_VERSION, requests: [] } satisfies PairingStore, async () => {
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

    let reqs = await readPairingRequests(filePath);
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
      await writeJsonFile(filePath, {
        version: CURRENT_VERSION,
        requests: capped,
      });
      return { code, created: false };
    }

    const { requests: capped, removed: cappedRemoved } = pruneExcessRequests(reqs, maxPending);
    reqs = capped;

    if (maxPending > 0 && reqs.length >= maxPending) {
      if (expiredRemoved || cappedRemoved) {
        await writeJsonFile(filePath, {
          version: CURRENT_VERSION,
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
    await writeJsonFile(filePath, {
      version: CURRENT_VERSION,
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

  const filePath = resolvePairingPath(params.channel, env);
  const { ttlMs } = resolvePendingLimits(params.limits);

  return withStoreLock(filePath, { version: CURRENT_VERSION, requests: [] } satisfies PairingStore, async () => {
    const nowMs = Date.now();
    const reqs = await readPairingRequests(filePath);
    const { requests: pruned, removed } = pruneExpiredRequests(reqs, nowMs, ttlMs);
    const normalizedAccountId = normalizePairingAccountId(params.accountId);

    const idx = pruned.findIndex(
      (entry) => normalizePairingCode(entry.code) === code && requestMatchesAccountId(entry, normalizedAccountId),
    );
    if (idx < 0) {
      if (removed) {
        await writeJsonFile(filePath, {
          version: CURRENT_VERSION,
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
    await writeJsonFile(filePath, {
      version: CURRENT_VERSION,
      requests: pruned,
    });

    await addChannelAllowFromStoreEntry({
      channel: params.channel,
      entry: entry.id,
      accountId: normalizedPairingAccountId(params.accountId) || (entry.meta?.accountId ? entry.meta.accountId : undefined),
      env,
    });

    return { id: entry.id, entry };
  });
}

function normalizedPairingAccountId(accountId?: string): string {
  return normalizePairingAccountId(accountId);
}
