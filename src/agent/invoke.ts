import { coreCoordinator } from "../bootstrap/coreCoordinator.js";

type NormalizedCoreResult = Awaited<ReturnType<typeof coreCoordinator.runAgent>>;

type RunAgentOutput = string;

interface RunAgentRuntimeContext {
  provider?: unknown;
  profileId?: unknown;
  withTools?: unknown;
  toolAllow?: unknown;
  newSession?: unknown;
  memory?: unknown;
  cwd?: unknown;
}

interface RunAgentRequest {
  input: string;
  channelId?: string;
  sessionKey?: string;
  runtime?: RunAgentRuntimeContext;
}

interface NormalizedRunAgentInput {
  provider: string;
  profileId: string;
  sessionKey: string;
  withTools: boolean;
  toolAllow: string[];
  newSession?: boolean;
  memory?: boolean;
  cwd?: string;
}

function toRunAgentResult(result: NormalizedCoreResult): RunAgentOutput {
  return result.result;
}

async function runAgentCore(input: string, request: RunAgentRequest): Promise<string> {
  const invocation = resolveRunAgentInput(request);
  const result = await coreCoordinator.runAgent(input, {
    provider: invocation.provider,
    profileId: invocation.profileId,
    sessionKey: invocation.sessionKey,
    withTools: invocation.withTools,
    toolAllow: invocation.toolAllow,
    ...(typeof invocation.newSession === "boolean" ? { newSession: invocation.newSession } : {}),
    ...(typeof invocation.memory === "boolean" ? { memory: invocation.memory } : {}),
    ...(typeof invocation.cwd === "string" ? { cwd: invocation.cwd } : {}),
  });
  return toRunAgentResult(result);
}

export async function runAgent(request: RunAgentRequest): Promise<string> {
  return runAgentCore(
    request.input,
    request,
  );
}

function resolveRunAgentInput(request: RunAgentRequest): NormalizedRunAgentInput {
  const runtime = request.runtime ?? {};
  return normalizeRunAgentInput(runtime, request.sessionKey);
}

function trimOrUndefined(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeToolAllow(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const values = raw
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return values.length > 0 ? values : undefined;
}

function normalizeRunAgentInput(input: RunAgentRuntimeContext, sessionKey?: unknown): NormalizedRunAgentInput {
  return {
    provider: trimOrUndefined(input.provider) || "",
    profileId: trimOrUndefined(input.profileId) || "",
    sessionKey: trimOrUndefined(sessionKey) || "main",
    withTools: typeof input.withTools === "boolean" ? input.withTools : true,
    toolAllow: normalizeToolAllow(input.toolAllow) || [],
    ...(typeof input.newSession === "boolean" ? { newSession: input.newSession } : {}),
    ...(typeof input.memory === "boolean" ? { memory: input.memory } : {}),
    ...(typeof input.cwd === "string" ? { cwd: input.cwd } : {}),
  };
}
