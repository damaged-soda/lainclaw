import { agentCoordinator } from "./coordinator.js";
import {
  buildLangfuseTags,
  isLangfuseTracingReady,
  propagateAttributes,
  runWithLangfuseFallback,
  startActiveObservation,
} from "../observability/langfuse.js";
import type { RuntimeAgentEventSink } from "../shared/types.js";
import { resolveRuntimePaths } from "../paths/index.js";

type NormalizedCoreResult = Awaited<ReturnType<typeof agentCoordinator.runAgent>>;

interface RunAgentOutput {
  requestId: string;
  sessionKey: string;
  sessionId: string;
  text: string;
  isNewSession?: boolean;
}

interface RunAgentRuntimeContext {
  provider?: unknown;
  profileId?: unknown;
  withTools?: unknown;
  newSession?: unknown;
  memory?: unknown;
  cwd?: unknown;
  debug?: unknown;
  userId?: unknown;
}

interface RunAgentRequest {
  input: string;
  channelId?: string;
  sessionKey?: string;
  runtime?: RunAgentRuntimeContext;
  onAgentEvent?: RuntimeAgentEventSink;
}

interface NormalizedRunAgentInput {
  provider: string;
  profileId: string;
  sessionKey: string;
  withTools: boolean;
  newSession?: boolean;
  memory?: boolean;
  cwd?: string;
  debug?: boolean;
  userId?: string;
}

function toRunAgentResult(result: NormalizedCoreResult): RunAgentOutput {
  return {
    requestId: result.requestId,
    sessionKey: result.sessionKey,
    sessionId: result.sessionId,
    text: result.text,
    isNewSession: result.isNewSession,
  };
}

async function runAgentCore(input: string, request: RunAgentRequest): Promise<RunAgentOutput> {
  const invocation = resolveRunAgentInput(request);
  const execute = async (): Promise<RunAgentOutput> => {
    const result = await agentCoordinator.runAgent(input, {
      provider: invocation.provider,
      profileId: invocation.profileId,
      sessionKey: invocation.sessionKey,
      withTools: invocation.withTools,
      ...(typeof invocation.newSession === "boolean" ? { newSession: invocation.newSession } : {}),
      ...(typeof invocation.memory === "boolean" ? { memory: invocation.memory } : {}),
      ...(typeof invocation.cwd === "string" ? { cwd: invocation.cwd } : {}),
      ...(typeof invocation.debug === "boolean" ? { debug: invocation.debug } : {}),
      ...(request.onAgentEvent ? { onAgentEvent: request.onAgentEvent } : {}),
    });
    return toRunAgentResult(result);
  };

  if (!isLangfuseTracingReady()) {
    return execute();
  }

  const tags = buildLangfuseTags([
    "app:lainclaw",
    "feature:agent",
    request.channelId ? `channel:${request.channelId}` : undefined,
    invocation.provider ? `provider:${invocation.provider}` : undefined,
    invocation.withTools ? "tools:on" : "tools:off",
  ]);

  return runWithLangfuseFallback(
    (executeObserved) => propagateAttributes(
      {
        sessionId: invocation.sessionKey,
        ...(invocation.userId ? { userId: invocation.userId } : {}),
        ...(tags.length > 0 ? { tags } : {}),
        metadata: {
          provider: invocation.provider,
          profileId: invocation.profileId,
          sessionKey: invocation.sessionKey,
          channel: request.channelId ?? "unknown",
        },
        traceName: "lainclaw.agent.run",
      },
      async () => startActiveObservation(
        "lainclaw.agent.run",
        async (agentObservation) => {
          agentObservation.update({
            input,
            metadata: {
              provider: invocation.provider,
              profileId: invocation.profileId,
              sessionKey: invocation.sessionKey,
              channelId: request.channelId ?? "unknown",
              withTools: invocation.withTools,
              ...(invocation.userId ? { userId: invocation.userId } : {}),
            },
          });
          agentObservation.setTraceIO({ input });

          try {
            const result = await executeObserved();
            agentObservation.update({
              output: result.text,
              metadata: {
                requestId: result.requestId,
                sessionId: result.sessionId,
                sessionKey: result.sessionKey,
                isNewSession: result.isNewSession === true,
              },
            });
            agentObservation.setTraceIO({ output: result.text });
            return result;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            agentObservation.update({
              level: "ERROR",
              statusMessage: message,
              output: {
                error: message,
              },
            });
            agentObservation.setTraceIO({
              output: {
                error: message,
              },
            });
            throw error;
          }
        },
        { asType: "agent" },
      ),
    ),
    execute,
    "agent.run",
  );
}

export async function runAgent(request: RunAgentRequest): Promise<RunAgentOutput> {
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

function normalizeRunAgentInput(input: RunAgentRuntimeContext, sessionKey?: unknown): NormalizedRunAgentInput {
  const userId = trimOrUndefined(input.userId);
  const workspace = resolveRuntimePaths().workspace;
  return {
    provider: trimOrUndefined(input.provider) || "",
    profileId: trimOrUndefined(input.profileId) || "",
    sessionKey: trimOrUndefined(sessionKey) || "main",
    withTools: typeof input.withTools === "boolean" ? input.withTools : true,
    ...(typeof input.newSession === "boolean" ? { newSession: input.newSession } : {}),
    ...(typeof input.memory === "boolean" ? { memory: input.memory } : {}),
    cwd: workspace,
    ...(typeof input.debug === "boolean" ? { debug: input.debug } : {}),
    ...(userId ? { userId } : {}),
  };
}
