import fs from "node:fs/promises";
import path from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import { resolveAuthDirectory } from "../auth/configStore.js";

const AGENT_STATE_DIR_NAME = "agent-state";
const AGENT_STATE_FILE_EXTENSION = ".json";
const AGENT_STATE_VERSION = 1 as const;

export interface AgentStateSnapshot {
  version: typeof AGENT_STATE_VERSION;
  sessionKey: string;
  sessionId: string;
  provider: string;
  profileId: string;
  systemPrompt: string;
  messages: Message[];
  updatedAt: string;
}

export interface AgentStateStore {
  load(sessionKey: string): Promise<AgentStateSnapshot | undefined>;
  save(snapshot: AgentStateSnapshot): Promise<void>;
  clear(sessionKey: string): Promise<void>;
  resolvePath(sessionKey: string): string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sanitizeSessionKey(sessionKey: string): string {
  return sessionKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .slice(0, 120)
    .replace(/^_+|_+$/g, "");
}

function resolveAgentStateDirectory(): string {
  return path.join(resolveAuthDirectory(), AGENT_STATE_DIR_NAME);
}

export function resolveAgentStateSnapshotPath(sessionKey: string): string {
  const safeSessionKey = sanitizeSessionKey(sessionKey);
  const fileName = `${safeSessionKey || "session"}${AGENT_STATE_FILE_EXTENSION}`;
  return path.join(resolveAgentStateDirectory(), fileName);
}

function isPersistedMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { role?: unknown };
  return (
    candidate.role === "user" ||
    candidate.role === "assistant" ||
    candidate.role === "toolResult"
  );
}

export function normalizePersistedMessages(raw: unknown): Message[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isPersistedMessage);
}

function sanitizeAgentStateSnapshot(raw: unknown): AgentStateSnapshot | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const candidate = raw as Partial<AgentStateSnapshot>;
  if (
    !isNonEmptyString(candidate.sessionKey) ||
    !isNonEmptyString(candidate.sessionId) ||
    !isNonEmptyString(candidate.provider) ||
    !isNonEmptyString(candidate.profileId) ||
    !isNonEmptyString(candidate.systemPrompt) ||
    !isNonEmptyString(candidate.updatedAt)
  ) {
    return undefined;
  }

  return {
    version: AGENT_STATE_VERSION,
    sessionKey: candidate.sessionKey,
    sessionId: candidate.sessionId,
    provider: candidate.provider,
    profileId: candidate.profileId,
    systemPrompt: candidate.systemPrompt,
    messages: normalizePersistedMessages(candidate.messages),
    updatedAt: candidate.updatedAt,
  };
}

export function createAgentStateStore(): AgentStateStore {
  return {
    async load(sessionKey: string): Promise<AgentStateSnapshot | undefined> {
      const snapshotPath = resolveAgentStateSnapshotPath(sessionKey);
      try {
        const raw = await fs.readFile(snapshotPath, "utf-8");
        return sanitizeAgentStateSnapshot(JSON.parse(raw));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return undefined;
        }
        throw error;
      }
    },
    async save(snapshot: AgentStateSnapshot): Promise<void> {
      const snapshotPath = resolveAgentStateSnapshotPath(snapshot.sessionKey);
      const tmpPath = `${snapshotPath}.tmp`;
      await fs.mkdir(resolveAgentStateDirectory(), { recursive: true });
      await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), "utf-8");
      await fs.rename(tmpPath, snapshotPath);
    },
    async clear(sessionKey: string): Promise<void> {
      const snapshotPath = resolveAgentStateSnapshotPath(sessionKey);
      try {
        await fs.unlink(snapshotPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    },
    resolvePath: resolveAgentStateSnapshotPath,
  };
}

export const agentStateStore = createAgentStateStore();
