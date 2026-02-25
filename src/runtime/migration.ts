import { RuntimeExecutionState, RuntimeStateEnvelope, RUNTIME_STATE_VERSION } from "./schema.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRuntimeExecutionState(value: unknown): value is RuntimeExecutionState {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.version === "number"
    && typeof value.channel === "string"
    && typeof value.sessionKey === "string"
    && typeof value.sessionId === "string"
    && typeof value.provider === "string"
    && typeof value.profileId === "string"
    && typeof value.runId === "string"
    && typeof value.runCreatedAt === "string"
    && typeof value.runUpdatedAt === "string"
    && typeof value.planId === "string"
    && typeof value.stepId === "number";
}

function sanitizeExecutionState(raw: unknown, fallbackRunId: string): RuntimeExecutionState {
  if (isRuntimeExecutionState(raw)) {
    return raw;
  }

  return {
    version: RUNTIME_STATE_VERSION,
    channel: "agent",
    sessionKey: "main",
    sessionId: fallbackRunId,
    provider: "openai-codex",
    profileId: "openai-codex/default",
    runId: fallbackRunId,
    runCreatedAt: new Date().toISOString(),
    runUpdatedAt: new Date().toISOString(),
    phase: "idle",
    planId: `plan-${fallbackRunId}`,
    stepId: 0,
  };
}

export function migrateRuntimeStateEnvelope(raw: unknown): RuntimeStateEnvelope {
  if (!isRecord(raw)) {
    return {};
  }

  const candidate = raw as Partial<{
    version?: unknown;
    current?: unknown;
    history?: unknown[];
  }>;
  const hasCurrent = isRecord(candidate.current);
  const hasHistory = Array.isArray(candidate.history);
  if (!hasCurrent && !hasHistory) {
    return {};
  }

  const currentPayload = candidate.current;
  const currentRunId = isRecord(currentPayload) && typeof currentPayload.runId === "string"
    ? String(currentPayload.runId)
    : `run-${Date.now()}`;

  return {
    current: isRecord(currentPayload) ? sanitizeExecutionState(currentPayload, currentRunId) : undefined,
    history: hasHistory ? candidate.history!.map((state) => sanitizeExecutionState(state, `run-${Date.now()}`)) : [],
  };
}
