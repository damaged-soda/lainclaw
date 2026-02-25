import { RuntimeExecutionState, RUNTIME_STATE_VERSION } from "./schema.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRuntimePhase(value: unknown): value is RuntimeExecutionState["phase"] {
  return value === "idle" || value === "running" || value === "suspended" || value === "failed";
}

function isRuntimeExecutionState(value: unknown): value is RuntimeExecutionState {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.channel === "string"
    && typeof value.sessionKey === "string"
    && typeof value.sessionId === "string"
    && typeof value.runId === "string"
    && isRuntimePhase(value.phase);
}

function sanitizeExecutionState(raw: unknown, fallbackRunId: string): RuntimeExecutionState {
  if (!isRecord(raw)) {
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

  const fallbackTs = new Date().toISOString();
  return {
    version: typeof raw.version === "number" ? raw.version : RUNTIME_STATE_VERSION,
    channel: typeof raw.channel === "string" && raw.channel.length > 0 ? raw.channel : "agent",
    sessionKey: typeof raw.sessionKey === "string" && raw.sessionKey.length > 0 ? raw.sessionKey : "main",
    sessionId: typeof raw.sessionId === "string" && raw.sessionId.length > 0 ? raw.sessionId : fallbackRunId,
    provider: typeof raw.provider === "string" && raw.provider.length > 0 ? raw.provider : "openai-codex",
    profileId: typeof raw.profileId === "string" && raw.profileId.length > 0 ? raw.profileId : "openai-codex/default",
    runId: typeof raw.runId === "string" && raw.runId.length > 0 ? raw.runId : fallbackRunId,
    runCreatedAt: typeof raw.runCreatedAt === "string" && raw.runCreatedAt.length > 0 ? raw.runCreatedAt : fallbackTs,
    runUpdatedAt: typeof raw.runUpdatedAt === "string" && raw.runUpdatedAt.length > 0 ? raw.runUpdatedAt : fallbackTs,
    phase: isRuntimePhase(raw.phase) ? raw.phase : "idle",
    planId: typeof raw.planId === "string" && raw.planId.length > 0 ? raw.planId : `plan-${fallbackRunId}`,
    stepId: typeof raw.stepId === "number" && Number.isFinite(raw.stepId) ? Math.max(0, Math.floor(raw.stepId)) : 0,
    ...(typeof raw.toolRunId === "string" && raw.toolRunId.length > 0 ? { toolRunId: raw.toolRunId } : {}),
    ...(typeof raw.lastRequestId === "string" && raw.lastRequestId.length > 0 ? { lastRequestId: raw.lastRequestId } : {}),
    ...(typeof raw.lastError === "string" && raw.lastError.length > 0 ? { lastError: raw.lastError } : {}),
    ...(typeof raw.lastEventId === "string" && raw.lastEventId.length > 0 ? { lastEventId: raw.lastEventId } : {}),
    ...(isRecord(raw.agentState) ? { agentState: raw.agentState as unknown as RuntimeExecutionState["agentState"] } : {}),
  };
}

export function migrateRuntimeExecutionState(raw: unknown): RuntimeExecutionState | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const statePayload = isRuntimeExecutionState(raw) ? raw : raw.current;
  if (!isRecord(statePayload)) {
    return undefined;
  }

  const fallbackRunId = isRecord(statePayload) && typeof statePayload.runId === "string"
    ? statePayload.runId
    : `run-${Date.now()}`;
  return sanitizeExecutionState(statePayload, fallbackRunId);
}
