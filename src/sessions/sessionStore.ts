import fs from "node:fs/promises";
import path from "node:path";
import { resolveAuthDirectory } from "../auth/configStore.js";
import type { SessionHistoryMessage } from "../shared/types.js";

const SESSION_DIR_NAME = "sessions";
const SESSION_INDEX_FILE = "sessions.json";
const CONTEXT_MESSAGE_LIMIT = 12;

interface SessionStoreCatalog {
  version: 1;
  sessions: Record<string, SessionRecord>;
}

export interface SessionRecord {
  sessionKey: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  provider?: string;
  profileId?: string;
  route?: string;
}

interface StoredSessionMessage {
  type: "message";
  message: SessionHistoryMessage & {
    route?: string;
    stage?: string;
    provider?: string;
    profileId?: string;
  };
}

function nowIso() {
  return new Date().toISOString();
}

function resolveSessionDirectory() {
  return path.join(resolveAuthDirectory(), SESSION_DIR_NAME);
}

function resolveSessionIndexPath() {
  return path.join(resolveSessionDirectory(), SESSION_INDEX_FILE);
}

function resolveSessionTranscriptPath(sessionId: string) {
  return path.join(resolveSessionDirectory(), `${sessionId}.jsonl`);
}

function isFiniteString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sanitizeCatalog(raw: unknown): SessionStoreCatalog {
  const candidate = raw as Partial<SessionStoreCatalog> | undefined;
  if (!candidate || typeof candidate !== "object") {
    return { version: 1, sessions: {} };
  }

  const output: SessionStoreCatalog = { version: 1, sessions: {} };

  if (typeof candidate.version === "number" && Number.isFinite(candidate.version)) {
    output.version = 1;
  }

  if (candidate.sessions && typeof candidate.sessions === "object") {
    const sessions = candidate.sessions as Record<string, unknown>;
    for (const [sessionKey, entry] of Object.entries(sessions)) {
      if (typeof sessionKey !== "string" || !entry || typeof entry !== "object") {
        continue;
      }

      const data = entry as Record<string, unknown>;
      if (!isFiniteString(data.sessionId) || !isFiniteString(data.sessionKey)) {
        continue;
      }
      const record: SessionRecord = {
        sessionKey: data.sessionKey,
        sessionId: data.sessionId,
        createdAt: isFiniteString(data.createdAt) ? data.createdAt : nowIso(),
        updatedAt: isFiniteString(data.updatedAt) ? data.updatedAt : nowIso(),
      };
      if (isFiniteString(data.provider)) {
        record.provider = data.provider;
      }
      if (isFiniteString(data.profileId)) {
        record.profileId = data.profileId;
      }
      if (isFiniteString(data.route)) {
        record.route = data.route;
      }
      output.sessions[sessionKey] = record;
    }
  }

  return output;
}

async function loadSessionCatalog(): Promise<SessionStoreCatalog> {
  const indexPath = resolveSessionIndexPath();
  try {
    const raw = await fs.readFile(indexPath, "utf-8");
    const parsed = JSON.parse(raw);
    return sanitizeCatalog(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, sessions: {} };
    }
    throw error;
  }
}

async function saveSessionCatalog(catalog: SessionStoreCatalog): Promise<void> {
  const sessionDir = resolveSessionDirectory();
  const indexPath = resolveSessionIndexPath();
  await fs.mkdir(sessionDir, { recursive: true });
  const tmpPath = `${indexPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(catalog, null, 2), "utf-8");
  await fs.rename(tmpPath, indexPath);
}

function createSessionId() {
  return `lc-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
}

function normalizeSessionMessage(message: unknown): SessionHistoryMessage | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const candidate = message as Record<string, unknown>;
  if (!isFiniteString(candidate.id) || !isFiniteString(candidate.role) || !isFiniteString(candidate.timestamp) || !isFiniteString(candidate.content)) {
    return null;
  }
  const role = candidate.role;
  if (role !== "user" && role !== "assistant" && role !== "system") {
    return null;
  }
  return {
    id: candidate.id,
    role,
    timestamp: candidate.timestamp,
    content: candidate.content,
  };
}

async function loadRecentMessages(sessionId: string): Promise<SessionHistoryMessage[]> {
  const transcript = resolveSessionTranscriptPath(sessionId);
  try {
    const raw = await fs.readFile(transcript, "utf-8");
    const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
    const normalized: SessionHistoryMessage[] = [];

    for (const line of lines) {
      const parsed = (() => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })();

      if (!parsed || typeof parsed !== "object") {
        continue;
      }

      if (parsed.type === "message" && "message" in parsed) {
        const normalizedMessage = normalizeSessionMessage((parsed as Record<string, unknown>).message);
        if (normalizedMessage) {
          normalized.push(normalizedMessage);
        }
      }
    }

    return normalized.slice(-CONTEXT_MESSAGE_LIMIT);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export interface SessionLoadOptions {
  sessionKey: string;
  provider?: string;
  profileId?: string;
  forceNew?: boolean;
}

export interface SessionLoadResult {
  sessionKey: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  isNewSession: boolean;
}

export async function getOrCreateSession({
  sessionKey,
  provider,
  profileId,
  forceNew,
}: SessionLoadOptions): Promise<SessionLoadResult> {
  const catalog = await loadSessionCatalog();
  const now = nowIso();
  const existing = catalog.sessions[sessionKey];

  if (existing && !forceNew) {
    const next: SessionRecord = {
      ...existing,
      updatedAt: now,
    };
    if (provider) {
      next.provider = provider;
    }
    if (profileId) {
      next.profileId = profileId;
    }
    catalog.sessions[sessionKey] = next;
    await saveSessionCatalog(catalog);
    return {
      sessionKey,
      sessionId: existing.sessionId,
      createdAt: existing.createdAt,
      updatedAt: now,
      isNewSession: false,
    };
  }

  const sessionId = createSessionId();
  catalog.sessions[sessionKey] = {
    sessionKey,
    sessionId,
    createdAt: now,
    updatedAt: now,
    ...(provider ? { provider } : {}),
    ...(profileId ? { profileId } : {}),
  };
  await saveSessionCatalog(catalog);

  return {
    sessionKey,
    sessionId,
    createdAt: now,
    updatedAt: now,
    isNewSession: true,
  };
}

export async function appendSessionMessage(
  sessionId: string,
  message: SessionHistoryMessage & {
    route?: string;
    stage?: string;
    provider?: string;
    profileId?: string;
  },
): Promise<void> {
  const record: StoredSessionMessage = {
    type: "message",
    message,
  };

  const transcriptPath = resolveSessionTranscriptPath(sessionId);
  await fs.mkdir(resolveSessionDirectory(), { recursive: true });
  await fs.appendFile(transcriptPath, `${JSON.stringify(record)}\n`, {
    encoding: "utf-8",
  });
}

export async function recordSessionRoute(
  sessionKey: string,
  route: string,
  profileId?: string,
  provider?: string,
) {
  const catalog = await loadSessionCatalog();
  const now = nowIso();
  const existing = catalog.sessions[sessionKey];
  if (!existing) {
    return;
  }
  existing.updatedAt = now;
  existing.route = route;
  if (profileId) {
    existing.profileId = profileId;
  }
  if (provider) {
    existing.provider = provider;
  }
  catalog.sessions[sessionKey] = existing;
  await saveSessionCatalog(catalog);
}

export function getRecentSessionMessages(sessionId: string): Promise<SessionHistoryMessage[]> {
  return loadRecentMessages(sessionId);
}
