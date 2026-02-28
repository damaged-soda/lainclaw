import type {
  CoreSessionRecord,
  CoreToolCall,
  CoreToolError,
  CoreToolExecutionLog,
  CoreOutcome,
  CoreRuntimeResult,
} from "./contracts.js";
import { nowIso, withFailureMapping } from "./errors.js";
import type { RunCtx, TurnContext } from "./internal.js";

const NEW_SESSION_ROUTE = "system";
const NEW_SESSION_STAGE = "gateway.new_session";

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

async function resolveTurnSession(ctx: RunCtx): Promise<CoreSessionRecord> {
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
        forceNew: false, // newSession 已在 index.ts 的分支里处理，runTurn 不再创建新会话
        ...(typeof ctx.memoryEnabled === "boolean" ? { memory: ctx.memoryEnabled } : {}),
      }),
  );
  return session;
}

async function runRuntimeForTurn(
  ctx: RunCtx,
  turnInput: string,
  turnCreatedAt: string,
  session: CoreSessionRecord,
  turnContext: TurnContext,
): Promise<CoreRuntimeResult> {
  return withFailureMapping(
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
        priorMessages: turnContext.priorMessages,
        memorySnippet: turnContext.memorySnippet,
        provider: ctx.provider,
        profileId: ctx.profileId,
        withTools: ctx.withTools,
        toolAllow: ctx.toolAllow,
        tools: turnContext.tools,
        ...(session.memoryEnabled ? { memoryEnabled: session.memoryEnabled } : {}),
        ...(typeof ctx.cwd === "string" ? { cwd: ctx.cwd } : {}),
      }),
  );
}

async function finalizeTurn(
  ctx: RunCtx,
  turnInput: string,
  session: CoreSessionRecord,
  runtimeResult: CoreRuntimeResult,
): Promise<void> {
  const toolCalls = runtimeResult.toolCalls ?? [];
  const toolResults = runtimeResult.toolResults ?? [];
  const toolError = ctx.toolsAdapter.firstToolErrorFromLogs(toolResults);
  await persistTurn(ctx, session, turnInput, runtimeResult, toolCalls, toolResults, toolError);
}

export async function runTurn(ctx: RunCtx, turnInput: string, turnCreatedAt: string): Promise<CoreOutcome> {
  const session = await resolveTurnSession(ctx);
  const turnContext = await buildTurnContext(ctx, session);
  const runtimeResult = await runRuntimeForTurn(ctx, turnInput, turnCreatedAt, session, turnContext);
  await finalizeTurn(ctx, turnInput, session, runtimeResult);

  return {
    requestId: ctx.requestId,
    text: runtimeResult.result,
    sessionKey: session.sessionKey,
    sessionId: session.sessionId,
  };
}
