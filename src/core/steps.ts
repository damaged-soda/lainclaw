import { ValidationError } from "../shared/types.js";
import type { CoreSessionRecord, CoreToolCall, CoreToolError, CoreToolExecutionLog, CoreOutcome, CoreErrorCode, CoreEventSink, CoreRuntimeResult } from "./contracts.js";
import type { RunCtx, TurnContext } from "./internal.js";

const NEW_SESSION_ROUTE = "system";
const NEW_SESSION_STAGE = "gateway.new_session";

function isCoreErrorCode(value: string | undefined): value is CoreErrorCode {
  return (
    value === "VALIDATION_ERROR" ||
    value === "MISSING_PROVIDER" ||
    value === "SESSION_FAILURE" ||
    value === "RUNTIME_FAILURE" ||
    value === "TOOL_FAILURE" ||
    value === "INTERNAL_ERROR"
  );
}

function toValidationError(error: unknown, fallback: CoreErrorCode): ValidationError {
  if (error instanceof ValidationError) {
    const code = typeof error.code === "string" ? error.code : undefined;
    if (isCoreErrorCode(code)) {
      return error;
    }
    return new ValidationError(error.message, fallback);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ValidationError(message || "agent request failed", fallback);
}

function nowIso(): string {
  return new Date().toISOString();
}

async function withFailureMapping<T>(
  stage: string,
  requestId: string,
  sessionKey: string,
  fallbackCode: CoreErrorCode,
  emitEvent: CoreEventSink,
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const normalized = toValidationError(error, fallbackCode);
    await emitEvent({
      level: "log",
      requestId,
      at: nowIso(),
      code: normalized.code as CoreErrorCode,
      name: `agent.request.${stage}.failed`,
      stage,
      message: normalized.message,
      sessionKey,
      payload: { code: normalized.code },
    });
    throw normalized;
  }
}

export async function buildTurnContext(
  ctx: RunCtx,
  session: CoreSessionRecord,
): Promise<TurnContext> {
  const [memorySnippet, priorMessages] = await Promise.all([
    withFailureMapping(
      "core.session.loadMemory",
      ctx.requestId,
      session.sessionKey,
      "SESSION_FAILURE",
      ctx.emitEvent,
      () => ctx.sessionAdapter.loadMemorySnippet(session.sessionKey),
    ),
    withFailureMapping(
      "core.session.loadHistory",
      ctx.requestId,
      session.sessionKey,
      "SESSION_FAILURE",
      ctx.emitEvent,
      () => ctx.sessionAdapter.loadHistory(session.sessionId),
    ),
  ]);
  const tools = await withFailureMapping(
    "core.tools.list",
    ctx.requestId,
    session.sessionKey,
    "TOOL_FAILURE",
    ctx.emitEvent,
    () => ctx.toolsAdapter.listTools({ allowList: ctx.toolAllow }),
  );

  return { memorySnippet, priorMessages, tools };
}

export async function persistTurn(
  ctx: RunCtx,
  session: CoreSessionRecord,
  turnInput: string,
  runtimeResult: CoreRuntimeResult,
  toolCalls: CoreToolCall[],
  toolResults: CoreToolExecutionLog[],
  toolError: CoreToolError | undefined,
): Promise<boolean> {
  if (toolResults.length > 0) {
    await withFailureMapping(
      "core.session.appendToolSummary",
      ctx.requestId,
      session.sessionKey,
      "SESSION_FAILURE",
      ctx.emitEvent,
      () =>
        ctx.sessionAdapter.appendToolSummary(
          session.sessionId,
          toolCalls,
          toolResults,
          runtimeResult.route,
          runtimeResult.stage,
          runtimeResult.provider,
          runtimeResult.profileId,
        ),
    );
  }

  await withFailureMapping(
    "core.session.appendTurnMessages",
    ctx.requestId,
    session.sessionKey,
    "SESSION_FAILURE",
    ctx.emitEvent,
    () =>
      ctx.sessionAdapter.appendTurnMessages(
        session.sessionId,
        turnInput,
        {
          route: runtimeResult.route,
          stage: runtimeResult.stage,
          result: runtimeResult.result,
          provider: runtimeResult.provider,
          profileId: runtimeResult.profileId,
        },
      ),
  );

  await withFailureMapping(
    "core.session.markRoute",
    ctx.requestId,
    session.sessionKey,
    "SESSION_FAILURE",
    ctx.emitEvent,
    () =>
      ctx.sessionAdapter.markRouteUsage(
        session.sessionKey,
        runtimeResult.route,
        runtimeResult.profileId,
        runtimeResult.provider,
      ),
  );

  const memoryUpdated = await withFailureMapping(
    "core.session.compact",
    ctx.requestId,
    session.sessionKey,
    "SESSION_FAILURE",
    ctx.emitEvent,
    () =>
      ctx.sessionAdapter.compactIfNeeded({
        sessionKey: session.sessionKey,
        sessionId: session.sessionId,
        memoryEnabled: session.memoryEnabled,
        compactedMessageCount: session.compactedMessageCount,
      }),
  );

  if (toolError) {
    await ctx.emitEvent({
      level: "log",
      requestId: ctx.requestId,
      at: nowIso(),
      code: "TOOL_FAILURE",
      name: "agent.runtime.tool.failed",
      route: runtimeResult.route,
      stage: runtimeResult.stage,
      message: toolError.message,
      sessionKey: session.sessionKey,
      payload: {
        tool: toolError.tool,
        toolCode: toolError.code,
      },
    });
  }

  await ctx.emitEvent({
    level: "event",
    requestId: ctx.requestId,
    at: nowIso(),
    name: "agent.request.completed",
    route: runtimeResult.route,
    stage: runtimeResult.stage,
    message: "agent request completed",
    sessionKey: session.sessionKey,
    payload: {
      memoryUpdated,
      sessionId: session.sessionId,
      provider: runtimeResult.provider,
      profileId: runtimeResult.profileId,
      toolError: Boolean(toolError),
    },
  });

  return memoryUpdated;
}

export async function startNewSession(ctx: RunCtx): Promise<CoreOutcome> {
  const newSessionRecord = await withFailureMapping(
    "core.session.resolve",
    ctx.requestId,
    ctx.sessionKey,
    "SESSION_FAILURE",
    ctx.emitEvent,
    () =>
      ctx.sessionAdapter.resolveSession({
        sessionKey: ctx.sessionKey,
        provider: ctx.provider,
        profileId: ctx.profileId,
        forceNew: true,
        ...(typeof ctx.memoryEnabled === "boolean" ? { memory: ctx.memoryEnabled } : {}),
      }),
  );

  await ctx.emitEvent({
    level: "event",
    requestId: ctx.requestId,
    at: nowIso(),
    name: "agent.session.created",
    route: NEW_SESSION_ROUTE,
    stage: NEW_SESSION_STAGE,
    message: "new session created",
    sessionKey: newSessionRecord.sessionKey,
    payload: { sessionId: newSessionRecord.sessionId },
  });

  return {
    requestId: ctx.requestId,
    sessionKey: newSessionRecord.sessionKey,
    sessionId: newSessionRecord.sessionId,
    text: "",
    isNewSession: true,
  };
}

export async function runTurn(ctx: RunCtx, turnInput: string, turnCreatedAt: string): Promise<CoreOutcome> {
  const session = await withFailureMapping(
    "core.session.resolve",
    ctx.requestId,
    ctx.sessionKey,
    "SESSION_FAILURE",
    ctx.emitEvent,
    () =>
      ctx.sessionAdapter.resolveSession({
        sessionKey: ctx.sessionKey,
        provider: ctx.provider,
        profileId: ctx.profileId,
        forceNew: false, // newSession is handled in runAgent; runTurn itself never creates a new session.
        ...(typeof ctx.memoryEnabled === "boolean" ? { memory: ctx.memoryEnabled } : {}),
      }),
  );

  const { memorySnippet, priorMessages, tools } = await buildTurnContext(ctx, session);

  const runtimeResult = await withFailureMapping(
    "core.runtime.run",
    ctx.requestId,
    session.sessionKey,
    "RUNTIME_FAILURE",
    ctx.emitEvent,
    () =>
      ctx.runtimeAdapter.run({
        requestId: ctx.requestId,
        createdAt: turnCreatedAt,
        input: turnInput,
        sessionKey: session.sessionKey,
        sessionId: session.sessionId,
        priorMessages,
        memorySnippet,
        provider: ctx.provider,
        profileId: ctx.profileId,
        withTools: ctx.withTools,
        toolAllow: ctx.toolAllow,
        tools,
        ...(session.memoryEnabled ? { memoryEnabled: session.memoryEnabled } : {}),
        ...(typeof ctx.cwd === "string" ? { cwd: ctx.cwd } : {}),
      }),
  );

  const toolCalls = runtimeResult.toolCalls ?? [];
  const toolResults = runtimeResult.toolResults ?? [];
  const toolError = ctx.toolsAdapter.firstToolErrorFromLogs(toolResults);
  await persistTurn(ctx, session, turnInput, runtimeResult, toolCalls, toolResults, toolError);

  return {
    requestId: ctx.requestId,
    text: runtimeResult.result,
    sessionKey: session.sessionKey,
    sessionId: session.sessionId,
  };
}
