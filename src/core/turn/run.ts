import type {
  CoreOutcome,
} from "../contracts.js";
import type { ProviderResult } from "../../providers/registry.js";
import { nowIso, withFailureMapping } from "../errors.js";
import type { RunCtx } from "../internal.js";
import { commitCoreTurn } from "./commit.js";
import { prepareCoreTurn } from "./prepare.js";
import type { PreparedTurn } from "./contracts.js";
import type { ToolError } from "../../tools/types.js";

const NEW_SESSION_ROUTE = "system";
const NEW_SESSION_STAGE = "gateway.new_session";

async function loadTurnTools(ctx: RunCtx): Promise<ReturnType<RunCtx["toolsAdapter"]["listTools"]>> {
  return withFailureMapping(
    "core.tools.list",
    ctx.requestId,
    ctx.sessionKey,
    "TOOL_FAILURE",
    ctx.emitEvent,
    () => ctx.toolsAdapter.listTools(),
  );
}

async function prepareTurn(ctx: RunCtx, turnInput: string): Promise<PreparedTurn> {
  return withFailureMapping(
    "core.turn.prepare",
    ctx.requestId,
    ctx.sessionKey,
    "SESSION_FAILURE",
    ctx.emitEvent,
    () =>
      prepareCoreTurn(
        {
          requestId: ctx.requestId,
          createdAt: ctx.createdAt,
          input: turnInput,
          sessionKey: ctx.sessionKey,
          provider: ctx.provider,
          profileId: ctx.profileId,
          runMode: ctx.runMode,
          continueReason: ctx.continueReason,
          memoryEnabled: ctx.memoryEnabled,
          withTools: ctx.withTools,
          ...(typeof ctx.cwd === "string" ? { cwd: ctx.cwd } : {}),
          ...(ctx.debug === true ? { debug: true } : {}),
        },
        {
          sessionPort: ctx.sessionAdapter,
        },
      ),
  );
}

async function runRuntimeForTurn(
  ctx: RunCtx,
  preparedTurn: PreparedTurn,
  tools: ReturnType<RunCtx["toolsAdapter"]["listTools"]>,
): Promise<ProviderResult> {
  return withFailureMapping(
    "core.runtime.run",
    ctx.requestId,
    preparedTurn.session.sessionKey,
    "RUNTIME_FAILURE",
    ctx.emitEvent,
    () =>
      ctx.runtimeAdapter.run({
        ...preparedTurn.providerInput,
        ...(tools.length > 0 ? { toolSpecs: tools } : {}),
        onAgentEvent: async (agentEvent) => {
          await ctx.emitEvent({
            level: "trace",
            requestId: ctx.requestId,
            at: nowIso(),
            name: "agent.runtime.event",
            message: agentEvent.event.type,
            sessionKey: preparedTurn.session.sessionKey,
            route: agentEvent.route,
            stage: "core.runtime.run",
            payload: {
              agentEvent,
            },
          });
          if (!ctx.onAgentEvent) {
            return;
          }
          try {
            await ctx.onAgentEvent(agentEvent);
          } catch {
            // External event sinks are observational only.
          }
        },
      }),
  );
}

async function commitTurn(
  ctx: RunCtx,
  preparedTurn: PreparedTurn,
  runtimeResult: ProviderResult,
): Promise<boolean> {
  const commitResult = await withFailureMapping(
    "core.turn.commit",
    ctx.requestId,
    preparedTurn.session.sessionKey,
    "SESSION_FAILURE",
    ctx.emitEvent,
    () =>
      commitCoreTurn(
        {
          preparedTurn,
          runtimeResult,
        },
        {
          sessionPort: ctx.sessionAdapter,
        },
      ),
  );

  return commitResult.memoryUpdated;
}

async function emitTurnCompleted(
  ctx: RunCtx,
  preparedTurn: PreparedTurn,
  runtimeResult: ProviderResult,
  toolError: ToolError | undefined,
  memoryUpdated: boolean,
): Promise<void> {
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
      sessionKey: preparedTurn.session.sessionKey,
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
    sessionKey: preparedTurn.session.sessionKey,
    payload: {
      memoryUpdated,
      sessionId: preparedTurn.session.sessionId,
      provider: runtimeResult.provider,
      profileId: runtimeResult.profileId,
      runMode: preparedTurn.providerInput.requestContext.runMode,
      continueReason: preparedTurn.providerInput.requestContext.continueReason,
      toolError: Boolean(toolError),
    },
  });
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

export async function runTurn(ctx: RunCtx, turnInput: string): Promise<CoreOutcome> {
  const preparedTurn = await prepareTurn(ctx, turnInput);
  const tools = await loadTurnTools(ctx);
  const runtimeResult = await runRuntimeForTurn(ctx, preparedTurn, tools);
  const toolResults = runtimeResult.toolResults ?? [];
  const toolError = ctx.toolsAdapter.firstToolErrorFromLogs(toolResults);
  const memoryUpdated = await commitTurn(ctx, preparedTurn, runtimeResult);
  await emitTurnCompleted(ctx, preparedTurn, runtimeResult, toolError, memoryUpdated);

  return {
    requestId: ctx.requestId,
    text: runtimeResult.result,
    sessionKey: preparedTurn.session.sessionKey,
    sessionId: preparedTurn.session.sessionId,
  };
}
