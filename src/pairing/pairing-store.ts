import crypto from "node:crypto";
import {
  DEFAULT_PAIRING_PENDING_MAX,
  DEFAULT_PAIRING_PENDING_TTL_MS,
  type PairingChannel,
  type PairingRequest,
  type PairingStoreLimits,
} from "./contracts.js";
import {
  hasPairingChannelData,
  loadPairingStoreFile,
  normalizePairingChannel,
  normalizePairingChannelState,
  resolvePairingStorePath,
  savePairingStoreFile,
  type PairingChannelState,
} from "./storeFile.js";

export {
  DEFAULT_PAIRING_PENDING_MAX,
  DEFAULT_PAIRING_PENDING_TTL_MS,
  type PairingChannel,
  type PairingPolicy,
  type PairingRequest,
  type PairingStoreLimits,
} from "./contracts.js";

const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const storeLocks = new Map<string, Promise<void>>();

function trimText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function normalizePairingAccountId(accountId?: string): string {
  return trimText(accountId).toLowerCase();
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

async function withStoreLock<T>(homeDir: string | undefined, fn: () => Promise<T>): Promise<T> {
  const filePath = resolvePairingStorePath(homeDir);
  const previous = storeLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entry = previous.catch(() => undefined).then(() => current);
  storeLocks.set(filePath, entry);
  await previous.catch(() => undefined);

  try {
    return await fn();
  } finally {
    release();
    if (storeLocks.get(filePath) === entry) {
      storeLocks.delete(filePath);
    }
  }
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
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
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

async function readPairingChannelState(
  homeDir: string | undefined,
  channel: PairingChannel,
): Promise<PairingChannelState> {
  const store = await loadPairingStoreFile(homeDir);
  return normalizePairingChannelState(store.channels?.[normalizePairingChannel(channel)]);
}

async function writePairingChannelState(
  homeDir: string | undefined,
  channel: PairingChannel,
  state: PairingChannelState,
): Promise<void> {
  const store = await loadPairingStoreFile(homeDir);
  const normalizedChannel = normalizePairingChannel(channel);
  const channels = { ...(store.channels ?? {}) };
  const nextState = normalizePairingChannelState(state);

  if (hasPairingChannelData(nextState)) {
    channels[normalizedChannel] = nextState;
  } else {
    delete channels[normalizedChannel];
  }

  await savePairingStoreFile({
    version: 1,
    ...(Object.keys(channels).length > 0 ? { channels } : {}),
  }, homeDir);
}

async function readAllowFromState(
  homeDir: string | undefined,
  channel: PairingChannel,
  accountId?: string,
): Promise<string[]> {
  const pairing = await readPairingChannelState(homeDir, channel);
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
  homeDir: string | undefined,
  channel: PairingChannel,
  nextAllowFrom: string[],
  accountId?: string,
): Promise<void> {
  const normalizedAccountId = accountId ? normalizePairingAccountId(accountId) || undefined : undefined;
  const pairing = await readPairingChannelState(homeDir, channel);
  const nextState: PairingChannelState = {
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
    }

    if (Object.keys(accountAllowFrom).length > 0) {
      nextState.accountAllowFrom = accountAllowFrom;
    } else {
      delete nextState.accountAllowFrom;
    }
  }

  await writePairingChannelState(homeDir, channel, nextState);
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
  const homeDir = env.HOME;
  const normalizedAccountId = params.accountId
    ? normalizePairingAccountId(params.accountId) || undefined
    : undefined;

  return withStoreLock(homeDir, async () => {
    const current = normalizeAndDedup(await readAllowFromState(homeDir, params.channel, normalizedAccountId));
    const normalized = normalizeAllowFromEntry(params.entry);
    if (!normalized) {
      return { changed: false, allowFrom: current };
    }

    const next = params.apply(current, normalized);
    if (!next) {
      return { changed: false, allowFrom: current };
    }

    const uniqueNext = normalizeAndDedup(next);
    await writeAllowFromState(homeDir, params.channel, uniqueNext, normalizedAccountId);
    return { changed: true, allowFrom: uniqueNext };
  });
}

export async function readChannelAllowFromStore(
  channel: PairingChannel,
  env: NodeJS.ProcessEnv = process.env,
  accountId?: string,
): Promise<string[]> {
  const homeDir = env.HOME;
  const normalizedAccountId = normalizePairingAccountId(accountId);
  if (!normalizedAccountId) {
    return readAllowFromState(homeDir, channel);
  }

  const scopedEntries = await readAllowFromState(homeDir, channel, normalizedAccountId);
  const legacyEntries = await readAllowFromState(homeDir, channel);
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
  const homeDir = env.HOME;
  const { ttlMs, maxPending } = resolvePendingLimits(limits);

  return withStoreLock(homeDir, async () => {
    const nowMs = Date.now();
    const currentState = await readPairingChannelState(homeDir, channel);
    const reqs = currentState.requests ?? [];
    const { requests: prunedExpired, removed: expiredRemoved } = pruneExpiredRequests(reqs, nowMs, ttlMs);
    const { requests: pruned, removed: cappedRemoved } = pruneExcessRequests(prunedExpired, maxPending);

    if (expiredRemoved || cappedRemoved) {
      await writePairingChannelState(homeDir, channel, {
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
  const homeDir = env.HOME;
  const id = trimText(params.id);
  if (!id) {
    throw new Error("invalid pairing sender id");
  }

  const { ttlMs, maxPending } = resolvePendingLimits(params.limits);

  return withStoreLock(homeDir, async () => {
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

    const currentState = await readPairingChannelState(homeDir, params.channel);
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
      await writePairingChannelState(homeDir, params.channel, {
        ...currentState,
        requests: capped,
      });
      return { code, created: false };
    }

    const { requests: capped, removed: cappedRemoved } = pruneExcessRequests(reqs, maxPending);
    reqs = capped;

    if (maxPending > 0 && reqs.length >= maxPending) {
      if (expiredRemoved || cappedRemoved) {
        await writePairingChannelState(homeDir, params.channel, {
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
    await writePairingChannelState(homeDir, params.channel, {
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
  const homeDir = env.HOME;
  const code = normalizePairingCode(params.code);
  if (!code) {
    return null;
  }

  const { ttlMs } = resolvePendingLimits(params.limits);

  return withStoreLock(homeDir, async () => {
    const nowMs = Date.now();
    const currentState = await readPairingChannelState(homeDir, params.channel);
    const reqs = currentState.requests ?? [];
    const { requests: pruned, removed } = pruneExpiredRequests(reqs, nowMs, ttlMs);
    const normalizedAccountId = normalizePairingAccountId(params.accountId);

    const idx = pruned.findIndex(
      (entry) => normalizePairingCode(entry.code) === code && requestMatchesAccountId(entry, normalizedAccountId),
    );
    if (idx < 0) {
      if (removed) {
        await writePairingChannelState(homeDir, params.channel, {
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
    const nextState: PairingChannelState = {
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

    await writePairingChannelState(homeDir, params.channel, nextState);
    return { id: entry.id, entry };
  });
}
