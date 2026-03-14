import fs from "node:fs/promises";
import path from "node:path";
import { resolveAuthDirectory } from "../auth/configStore.js";
import type { PairingChannel, PairingRequest } from "./contracts.js";

const CURRENT_PAIRING_STORE_VERSION = 1 as const;
const PAIRING_STORE_FILE = "pairing.json";

export interface PairingChannelState {
  requests?: PairingRequest[];
  allowFrom?: string[];
  accountAllowFrom?: Record<string, string[]>;
}

export interface PairingStoreFile {
  version: 1;
  channels?: Record<string, PairingChannelState>;
}

const DEFAULT_PAIRING_STORE_FILE: PairingStoreFile = {
  version: CURRENT_PAIRING_STORE_VERSION,
  channels: {},
};

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

function trimText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
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

function normalizePairingAccountId(accountId?: string): string {
  return trimText(accountId).toLowerCase();
}

export function normalizePairingChannel(channel: PairingChannel): string {
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

function normalizePairingRequestList(raw: unknown): PairingRequest[] {
  const candidate = isRecord(raw) ? raw.requests : raw;
  const requests = Array.isArray(candidate) ? candidate : [];
  const normalized: PairingRequest[] = [];

  for (const entry of requests) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const asRecord = entry as Record<string, unknown>;
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
        .map(([key, value]) => [key, trimText(value)] as const)
        .filter(([_, value]) => Boolean(value)),
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

export function normalizePairingChannelState(raw: unknown): PairingChannelState {
  if (!isRecord(raw)) {
    return { requests: [] };
  }

  const candidate = raw as Partial<PairingChannelState>;
  const requests = normalizePairingRequestList(candidate.requests);
  const allowFrom = normalizeAndDedup(Array.isArray(candidate.allowFrom) ? candidate.allowFrom : []);
  const rawAccountAllowFrom = isRecord(candidate.accountAllowFrom) ? candidate.accountAllowFrom : {};
  const accountAllowFrom: Record<string, string[]> = {};

  for (const [accountId, rawEntries] of Object.entries(rawAccountAllowFrom)) {
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

export function hasPairingChannelData(state: PairingChannelState): boolean {
  return (
    (state.requests?.length ?? 0) > 0
    || (state.allowFrom?.length ?? 0) > 0
    || Object.keys(state.accountAllowFrom ?? {}).length > 0
  );
}

export function normalizePairingStoreFile(raw: unknown): PairingStoreFile {
  if (!isRecord(raw)) {
    return DEFAULT_PAIRING_STORE_FILE;
  }

  const candidate = raw as Partial<PairingStoreFile>;
  if (!Number.isInteger(candidate.version) || candidate.version !== CURRENT_PAIRING_STORE_VERSION) {
    return DEFAULT_PAIRING_STORE_FILE;
  }

  const channelsSource = isRecord(candidate.channels) ? candidate.channels : {};
  const channels: Record<string, PairingChannelState> = {};

  for (const [rawChannel, rawState] of Object.entries(channelsSource)) {
    const channel = normalizePairingChannel(rawChannel);
    const state = normalizePairingChannelState(rawState);
    if (hasPairingChannelData(state)) {
      channels[channel] = state;
    }
  }

  return {
    version: CURRENT_PAIRING_STORE_VERSION,
    ...(Object.keys(channels).length > 0 ? { channels } : {}),
  };
}

function hasPersistedPairingData(store: PairingStoreFile): boolean {
  return Boolean(store.channels && Object.keys(store.channels).length > 0);
}

export function resolvePairingStorePath(homeDir = process.env.HOME): string {
  return path.join(resolveAuthDirectory(homeDir), PAIRING_STORE_FILE);
}

export async function loadPairingStoreFile(homeDir = process.env.HOME): Promise<PairingStoreFile> {
  const filePath = resolvePairingStorePath(homeDir);
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf-8")) as unknown;
    return normalizePairingStoreFile(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    return DEFAULT_PAIRING_STORE_FILE;
  }
}

export async function savePairingStoreFile(
  store: PairingStoreFile,
  homeDir = process.env.HOME,
): Promise<void> {
  const normalized = normalizePairingStoreFile(store);
  const filePath = resolvePairingStorePath(homeDir);

  if (!hasPersistedPairingData(normalized)) {
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

  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.tmp-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
  await fs.writeFile(tmpPath, JSON.stringify(normalized, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.rename(tmpPath, filePath);
}
