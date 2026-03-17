import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveLainclawHome, resolvePaths, resolveRuntimePaths } from "../../paths/index.js";

const FEISHU_PAIRING_FILE = "feishu-pairing.json";
const CURRENT_FEISHU_PAIRING_VERSION = 1 as const;
const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface FeishuPendingPairing {
  openId: string;
  code: string;
}

interface FeishuPairingState {
  version: 1;
  approvedOpenIds: string[];
  pending: FeishuPendingPairing[];
}

const EMPTY_FEISHU_PAIRING_STATE: FeishuPairingState = {
  version: CURRENT_FEISHU_PAIRING_VERSION,
  approvedOpenIds: [],
  pending: [],
};

const pairingLocks = new Map<string, Promise<void>>();

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

function trimText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function normalizeOpenId(raw: unknown): string {
  return trimText(raw).toLowerCase();
}

function normalizeCode(raw: unknown): string {
  return trimText(raw).toUpperCase();
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const normalized = normalizeOpenId(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizePending(raw: unknown, approvedOpenIds: string[]): FeishuPendingPairing[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const approved = new Set(approvedOpenIds);
  const seenOpenIds = new Set<string>();
  const seenCodes = new Set<string>();
  const out: FeishuPendingPairing[] = [];

  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }

    const openId = normalizeOpenId(entry.openId);
    const code = normalizeCode(entry.code);
    if (!openId || !code || approved.has(openId) || seenOpenIds.has(openId) || seenCodes.has(code)) {
      continue;
    }

    seenOpenIds.add(openId);
    seenCodes.add(code);
    out.push({ openId, code });
  }

  return out;
}

function normalizeFeishuPairingState(raw: unknown): FeishuPairingState {
  if (!isRecord(raw) || raw.version !== CURRENT_FEISHU_PAIRING_VERSION) {
    return EMPTY_FEISHU_PAIRING_STATE;
  }

  const approvedOpenIds = normalizeStringList(raw.approvedOpenIds);
  const pending = normalizePending(raw.pending, approvedOpenIds);

  return {
    version: CURRENT_FEISHU_PAIRING_VERSION,
    approvedOpenIds,
    pending,
  };
}

function hasPersistedState(state: FeishuPairingState): boolean {
  return state.approvedOpenIds.length > 0 || state.pending.length > 0;
}

function randomCode(): string {
  let out = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    const idx = crypto.randomInt(0, PAIRING_CODE_ALPHABET.length);
    out += PAIRING_CODE_ALPHABET[idx];
  }
  return out;
}

function generateUniqueCode(existingCodes: Set<string>): string {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const code = randomCode();
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  throw new Error("failed to generate unique feishu pairing code");
}

async function withPairingLock<T>(env: NodeJS.ProcessEnv | undefined, fn: () => Promise<T>): Promise<T> {
  const filePath = resolveFeishuPairingStatePath(env);
  const previous = pairingLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entry = previous.catch(() => undefined).then(() => current);
  pairingLocks.set(filePath, entry);
  await previous.catch(() => undefined);

  try {
    return await fn();
  } finally {
    release();
    if (pairingLocks.get(filePath) === entry) {
      pairingLocks.delete(filePath);
    }
  }
}

async function loadFeishuPairingState(env: NodeJS.ProcessEnv = process.env): Promise<FeishuPairingState> {
  const filePath = resolveFeishuPairingStatePath(env);
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf-8")) as unknown;
    return normalizeFeishuPairingState(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return EMPTY_FEISHU_PAIRING_STATE;
    }
    throw error;
  }
}

async function saveFeishuPairingState(
  state: FeishuPairingState,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const normalized = normalizeFeishuPairingState(state);
  const filePath = resolveFeishuPairingStatePath(env);

  if (!hasPersistedState(normalized)) {
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

export function resolveFeishuPairingStatePath(homeDirOrEnv?: string | NodeJS.ProcessEnv): string {
  if (typeof homeDirOrEnv === "string") {
    return resolvePaths(homeDirOrEnv).feishuPairing;
  }
  if (homeDirOrEnv && typeof homeDirOrEnv === "object") {
    return resolvePaths(resolveLainclawHome(homeDirOrEnv)).feishuPairing;
  }
  return resolveRuntimePaths().feishuPairing;
}

export function buildFeishuPairingReply(openId: string, code: string): string {
  return [
    "当前账号尚未完成 pairing。",
    "",
    `openId: ${openId}`,
    "",
    `Pairing code: ${code}`,
    "",
    "请让管理员执行以下命令完成配对：",
    `lainclaw pairing approve ${code}`,
  ].join("\n");
}

export async function isFeishuPaired(
  openId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const normalizedOpenId = normalizeOpenId(openId);
  if (!normalizedOpenId) {
    return false;
  }

  const state = await loadFeishuPairingState(env);
  return state.approvedOpenIds.includes(normalizedOpenId);
}

export async function issueFeishuPairingCode(
  openId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: string; created: boolean }> {
  const normalizedOpenId = normalizeOpenId(openId);
  if (!normalizedOpenId) {
    throw new Error("invalid feishu open id");
  }

  return withPairingLock(env, async () => {
    const state = await loadFeishuPairingState(env);
    const existing = state.pending.find((entry) => entry.openId === normalizedOpenId);
    if (existing) {
      return { code: existing.code, created: false };
    }

    const code = generateUniqueCode(new Set(state.pending.map((entry) => entry.code)));
    await saveFeishuPairingState({
      ...state,
      pending: [...state.pending, { openId: normalizedOpenId, code }],
    }, env);
    return { code, created: true };
  });
}

export async function approveFeishuPairingCode(
  code: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) {
    return null;
  }

  return withPairingLock(env, async () => {
    const state = await loadFeishuPairingState(env);
    const index = state.pending.findIndex((entry) => entry.code === normalizedCode);
    if (index < 0) {
      return null;
    }

    const entry = state.pending[index];
    if (!entry) {
      return null;
    }

    const pending = state.pending.slice();
    pending.splice(index, 1);

    await saveFeishuPairingState({
      ...state,
      approvedOpenIds: normalizeStringList([...state.approvedOpenIds, entry.openId]),
      pending,
    }, env);

    return entry.openId;
  });
}
