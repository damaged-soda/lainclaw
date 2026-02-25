import fs from "node:fs/promises";
import path from "node:path";
import {
  RuntimeExecutionState,
  RuntimePhase,
  RuntimeStateEnvelope,
  RUNTIME_STATE_VERSION,
} from "./schema.js";
import { resolveAuthDirectory } from "../auth/configStore.js";
import { migrateRuntimeStateEnvelope } from "./migration.js";

interface RuntimeStateStoreParams {
  channel: string;
  sessionKey: string;
  sessionId: string;
  provider: string;
  profileId: string;
  runId: string;
  patch: Partial<RuntimeExecutionState>;
  eventId?: string;
}

const RUNTIME_DIR_NAME = "runtime";
const MAX_HISTORY = 20;
const JSON_PRETTY = 2;
const STATE_WRITE_QUEUE = new Map<string, Promise<unknown>>();

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeSegment(raw: string): string {
  const normalized = (raw || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
  const trimmed = normalized.replace(/^_+|_+$/g, "");
  return trimmed || "default";
}

function resolveRuntimeDirectory(): string {
  return path.join(resolveAuthDirectory(), RUNTIME_DIR_NAME);
}

export function resolveRuntimeStatePath(channel: string, sessionKey: string): string {
  const safeChannel = sanitizeSegment(channel);
  const safeSession = sanitizeSegment(sessionKey);
  return path.join(resolveRuntimeDirectory(), `${safeChannel}--${safeSession}.json`);
}

function normalizePhase(raw: unknown): RuntimePhase {
  if (raw === "idle" || raw === "running" || raw === "suspended" || raw === "failed") {
    return raw;
  }
  return "idle";
}

function createFallbackRuntimeState(
  channel: string,
  sessionKey: string,
  sessionId: string,
  provider: string,
  profileId: string,
  runId: string,
): RuntimeExecutionState {
  return {
    version: RUNTIME_STATE_VERSION,
    channel,
    sessionKey,
    sessionId,
    provider,
    profileId,
    runId,
    runCreatedAt: nowIso(),
    runUpdatedAt: nowIso(),
    phase: "running",
    planId: `plan-${runId}`,
    stepId: 0,
  };
}

function normalizeRuntimeExecutionState(
  raw: Partial<RuntimeExecutionState>,
  channel: string,
  sessionKey: string,
  sessionId: string,
  provider: string,
  profileId: string,
  runId: string,
): RuntimeExecutionState {
  return {
    version: RUNTIME_STATE_VERSION,
    channel,
    sessionKey,
    sessionId,
    provider,
    profileId,
    runId,
    runCreatedAt: typeof raw.runCreatedAt === "string" ? raw.runCreatedAt : nowIso(),
    runUpdatedAt: nowIso(),
    phase: normalizePhase(raw.phase),
    planId: raw.planId ? String(raw.planId) : `plan-${runId}`,
    stepId: Number.isFinite(raw.stepId) ? Math.max(0, Math.floor(raw.stepId)) : 0,
    ...(typeof raw.toolRunId === "string" ? { toolRunId: raw.toolRunId } : {}),
    ...(typeof raw.lastRequestId === "string" ? { lastRequestId: raw.lastRequestId } : {}),
    ...(raw.lastError ? { lastError: raw.lastError } : {}),
    ...(raw.lastEventId ? { lastEventId: raw.lastEventId } : {}),
    ...(raw.lastGoodSnapshot ? { lastGoodSnapshot: raw.lastGoodSnapshot } : {}),
    ...(raw.agentState ? { agentState: raw.agentState } : {}),
  };
}

function makeWriteTempPath(statePath: string): string {
  const unique = `${Date.now().toString(16)}-${process.pid.toString(16)}-${Math.floor(Math.random() * 0xFFFF).toString(16)}`;
  return `${statePath}.${unique}.tmp`;
}

function queueWrite<T>(statePath: string, action: () => Promise<T>): Promise<T> {
  const previous = STATE_WRITE_QUEUE.get(statePath) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(action);
  const done = current.then(() => undefined, () => undefined);
  STATE_WRITE_QUEUE.set(statePath, done);
  done.finally(() => {
    if (STATE_WRITE_QUEUE.get(statePath) === done) {
      STATE_WRITE_QUEUE.delete(statePath);
    }
  });
  return current;
}

function writeEnvelope(statePath: string, envelope: RuntimeStateEnvelope): Promise<void> {
  return fs.mkdir(path.dirname(statePath), { recursive: true }).then(() => {
    const tempPath = makeWriteTempPath(statePath);
    return fs.writeFile(tempPath, JSON.stringify(envelope, null, JSON_PRETTY), "utf-8")
      .then(() => fs.rename(tempPath, statePath));
  });
}

export async function loadRuntimeStateEnvelope(
  channel: string,
  sessionKey: string,
): Promise<RuntimeStateEnvelope> {
  const statePath = resolveRuntimeStatePath(channel, sessionKey);
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw);
    return migrateRuntimeStateEnvelope(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    return {};
  }
}

export async function loadRuntimeExecutionState(
  channel: string,
  sessionKey: string,
): Promise<RuntimeExecutionState | undefined> {
  const envelope = await loadRuntimeStateEnvelope(channel, sessionKey);
  return envelope.current;
}

export async function persistRuntimeExecutionState(
  params: RuntimeStateStoreParams,
): Promise<RuntimeExecutionState> {
  const statePath = resolveRuntimeStatePath(params.channel, params.sessionKey);

  return queueWrite(statePath, async () => {
    const envelope = await loadRuntimeStateEnvelope(params.channel, params.sessionKey);

    let current = envelope.current;
    if (!current || current.runId !== params.runId) {
      if (current) {
        const history = Array.isArray(envelope.history) ? [...envelope.history] : [];
        history.unshift(current);
        envelope.history = history.slice(0, MAX_HISTORY);
      }
      current = createFallbackRuntimeState(
        params.channel,
        params.sessionKey,
        params.sessionId,
        params.provider,
        params.profileId,
        params.runId,
      );
    }

    if (params.eventId && current.lastEventId && current.lastEventId === params.eventId) {
      return current;
    }

    const patch = {
      ...current,
      ...params.patch,
      lastEventId: params.eventId,
    };
    const next = normalizeRuntimeExecutionState(
      patch,
      params.channel,
      params.sessionKey,
      params.sessionId,
      params.provider,
      params.profileId,
      params.runId,
    );

    envelope.current = next;
    await writeEnvelope(statePath, envelope);
    return next;
  });
}

export function createRuntimeRunId(): string {
  return `run-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
}
