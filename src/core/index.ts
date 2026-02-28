import {
  createRuntimeAdapter,
  type CoreRuntimeAdapter,
} from "./adapters/runtime.js";
import {
  createSessionAdapter,
  type CoreSessionAdapter,
} from "./adapters/session.js";
import {
  createToolsAdapter,
  type CoreToolsAdapter,
} from "./adapters/tools.js";
import type {
  CoreCoordinator,
  CoreErrorCode,
  CoreEventSink,
  CoreRunAgentOptions,
} from "./contracts.js";
import type { RunCtx } from "./internal.js";
import { nowIso, toValidationError } from "./errors.js";
import { runTurn, startNewSession } from "./steps.js";

export interface CreateCoreCoordinatorOptions {
  sessionAdapter: CoreSessionAdapter;
  toolsAdapter: CoreToolsAdapter;
  runtimeAdapter: CoreRuntimeAdapter;
  emitEvent?: CoreEventSink;
}

// === Errors & events ===

function createDefaultEmitEvent(): CoreEventSink {
  return async (event) => {
    if (event.level === "log" && event.code) {
      console.error(`[core][${event.name}] ${event.message ?? "agent failed"}`);
    }
  };
}

function createEventSink(handler: CoreEventSink): CoreEventSink {
  return async (event) => {
    try {
      await Promise.resolve(handler(event));
    } catch {
      // event sink should not impact execution path.
    }
  };
}

function createRequestId(): string {
  return `lc-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
}

// === CoreCoordinator factory (public entrypoint) ===

export function createCoreCoordinator(options: CreateCoreCoordinatorOptions): CoreCoordinator {
  const sessionAdapter = createSessionAdapter({ implementation: options.sessionAdapter });
  const toolsAdapter = createToolsAdapter({ implementation: options.toolsAdapter });
  const runtimeAdapter = createRuntimeAdapter({ implementation: options.runtimeAdapter });
  const emitEvent = createEventSink(options.emitEvent ?? createDefaultEmitEvent());

  const coordinator: CoreCoordinator = {
    runAgent: async (rawInput: string, options: CoreRunAgentOptions) => {
      const requestId = createRequestId();
      const createdAt = nowIso();
      const {
        provider,
        profileId,
        memory: memoryEnabled,
        sessionKey,
        withTools,
        toolAllow,
        newSession,
        cwd,
      } = options;

      const ctx: RunCtx = {
        requestId,
        createdAt,
        provider,
        profileId,
        sessionKey,
        withTools,
        toolAllow,
        memoryEnabled,
        cwd: typeof cwd === "string" ? cwd : undefined,
        emitEvent,
        sessionAdapter,
        toolsAdapter,
        runtimeAdapter,
      };

      try {
        // 1) received
        await ctx.emitEvent({
          level: "trace",
          requestId,
          at: createdAt,
          name: "agent.request.received",
          message: "agent request started",
          sessionKey: ctx.sessionKey,
          payload: {
            provider: ctx.provider,
            profileId: ctx.profileId,
            withTools: ctx.withTools,
            hasToolFilter: ctx.toolAllow.length > 0,
          },
        });

        // 2) either new session or normal turn
        if (newSession === true) {
          return await startNewSession(ctx);
        }

        return await runTurn(ctx, rawInput, createdAt);
      } catch (error) {
        // 3) failed
        const normalized = toValidationError(error, "INTERNAL_ERROR");
        await ctx.emitEvent({
          level: "log",
          requestId,
          at: nowIso(),
          code: normalized.code as CoreErrorCode,
          name: "agent.request.failed",
          stage: "agent.request",
          message: normalized.message,
          sessionKey: ctx.sessionKey,
          payload: {
            provider: ctx.provider,
            profileId: ctx.profileId,
            code: normalized.code,
          },
        });
        throw normalized;
      }
    },
  };

  return coordinator;
}

export const createCoordinator = createCoreCoordinator;
