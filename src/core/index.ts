import { ValidationError } from "../shared/types.js";
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
import {
  CoreCoordinator,
  type CoreErrorCode,
  type CoreEventSink,
  type CoreRunAgentOptions,
  type CoreSessionLoadInput,
  type CoreSessionRecord,
  type CoreSessionSnapshotCompact,
  type CoreSessionTurnResult,
  type CoreSessionHistoryMessage,
  type CoreToolCall,
  type CoreToolError,
  type CoreToolExecutionLog,
  type CoreRuntimeInput,
} from "./contracts.js";

export interface CreateCoreCoordinatorOptions {
  sessionAdapter: CoreSessionAdapter;
  toolsAdapter: CoreToolsAdapter;
  runtimeAdapter: CoreRuntimeAdapter;
  emitEvent?: CoreEventSink;
}

const NEW_SESSION_ROUTE = "system";
const NEW_SESSION_STAGE = "gateway.new_session";

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

function nowIso(): string {
  return new Date().toISOString();
}

function createRequestId(): string {
  return `lc-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
}

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

export function createCoreCoordinator(options: CreateCoreCoordinatorOptions): CoreCoordinator {
  const sessionAdapter = createSessionAdapter({ implementation: options.sessionAdapter });
  const toolsAdapter = createToolsAdapter({ implementation: options.toolsAdapter });
  const runtimeAdapter = createRuntimeAdapter({ implementation: options.runtimeAdapter });
  const emitEvent = createEventSink(options.emitEvent ?? createDefaultEmitEvent());

  const coordinator: CoreCoordinator = {
    emitEvent,
    runRuntime: (input: CoreRuntimeInput) => {
      return withFailureMapping(
        "core.runtime.runRuntime",
        input.requestId,
        input.sessionKey,
        "RUNTIME_FAILURE",
        emitEvent,
        () => runtimeAdapter.run(input),
      );
    },
    resolveSession: (input: CoreSessionLoadInput): Promise<CoreSessionRecord> => {
      return sessionAdapter.resolveSession(input);
    },
    listTools: (options) => {
      return toolsAdapter.listTools(options);
    },
    executeTool: (call: CoreToolCall, context) => {
      return toolsAdapter.executeTool(call, context);
    },
    firstToolErrorFromLogs: (
      logs: CoreToolExecutionLog[] | undefined,
    ): CoreToolError | undefined => {
      return toolsAdapter.firstToolErrorFromLogs(logs);
    },
    compactSession: (input: CoreSessionSnapshotCompact): Promise<boolean> => {
      return sessionAdapter.compactIfNeeded(input);
    },
    appendTurnMessages: (
      sessionId: string,
      userInput: string,
      finalResult: CoreSessionTurnResult,
    ): Promise<void> => {
      return sessionAdapter.appendTurnMessages(sessionId, userInput, finalResult);
    },
    appendToolSummary: async (
      sessionId: string,
      toolCalls,
      toolResults,
      route,
      stage,
      provider,
      profileId,
    ): Promise<void> => {
      await sessionAdapter.appendToolSummary(
        sessionId,
        toolCalls,
        toolResults,
        route,
        stage,
        provider,
        profileId,
      );
    },
    markRouteUsage: (
      sessionKey: string,
      route: string,
      profileId: string,
      provider: string,
    ): Promise<void> => {
      return sessionAdapter.markRouteUsage(sessionKey, route, profileId, provider);
    },
    loadHistory: (sessionId: string): Promise<CoreSessionHistoryMessage[]> => {
      return sessionAdapter.loadHistory(sessionId);
    },
    loadMemorySnippet: (sessionKey: string): Promise<string> => {
      return sessionAdapter.loadMemorySnippet(sessionKey);
    },
    resolveSessionMemoryPath: (sessionKey: string): string => {
      return sessionAdapter.resolveSessionMemoryPath(sessionKey);
    },
    runAgent: async (rawInput: string, options: CoreRunAgentOptions) => {
      const requestId = createRequestId();
      const createdAt = nowIso();
      const input = rawInput;
      const requestIsNewSession = options.newSession === true;

      const provider = options.provider;
      const profileId = options.profileId;
      const memoryEnabled = options.memory;
      const sessionKey = options.sessionKey;
      const withTools = options.withTools;
      const toolAllow = options.toolAllow;

      try {
        await emitEvent({
          level: "trace",
          requestId,
          at: createdAt,
          name: "agent.request.received",
          message: "agent request started",
          sessionKey,
          payload: {
            provider,
            profileId,
            withTools,
            hasToolFilter: toolAllow.length > 0,
          },
        });

      if (requestIsNewSession) {
        const newSession = await withFailureMapping(
            "core.session.resolve",
            requestId,
            sessionKey,
            "SESSION_FAILURE",
            emitEvent,
            () =>
              sessionAdapter.resolveSession({
                sessionKey,
                provider,
                profileId,
                forceNew: true,
                ...(typeof memoryEnabled === "boolean" ? { memory: memoryEnabled } : {}),
              }),
          );

          await emitEvent({
            level: "event",
            requestId,
            at: nowIso(),
            name: "agent.session.created",
            route: NEW_SESSION_ROUTE,
            stage: NEW_SESSION_STAGE,
            message: "new session created",
            sessionKey: newSession.sessionKey,
            payload: { sessionId: newSession.sessionId },
          });

          return {
            requestId,
            sessionKey: newSession.sessionKey,
            sessionId: newSession.sessionId,
            text: "",
            isNewSession: true,
          };
        }

        const session = await withFailureMapping(
          "core.session.resolve",
          requestId,
          sessionKey,
          "SESSION_FAILURE",
          emitEvent,
          () =>
            sessionAdapter.resolveSession({
              sessionKey,
              provider,
              profileId,
              forceNew: !!options.newSession,
              ...(typeof memoryEnabled === "boolean" ? { memory: memoryEnabled } : {}),
            }),
        );

        const [memorySnippet, priorMessages] = await Promise.all([
          withFailureMapping(
            "core.session.loadMemory",
            requestId,
            session.sessionKey,
            "SESSION_FAILURE",
            emitEvent,
            () => sessionAdapter.loadMemorySnippet(session.sessionKey),
          ),
          withFailureMapping(
            "core.session.loadHistory",
            requestId,
            session.sessionKey,
            "SESSION_FAILURE",
            emitEvent,
            () => sessionAdapter.loadHistory(session.sessionId),
          ),
        ]);

        const autoTools = await withFailureMapping(
          "core.tools.list",
          requestId,
          session.sessionKey,
          "TOOL_FAILURE",
          emitEvent,
          () => toolsAdapter.listTools({ allowList: toolAllow }),
        );

        const runtimeResult = await withFailureMapping(
          "core.runtime.run",
          requestId,
          session.sessionKey,
          "RUNTIME_FAILURE",
          emitEvent,
          () =>
            runtimeAdapter.run({
              requestId,
              createdAt,
              input,
              sessionKey: session.sessionKey,
              sessionId: session.sessionId,
              priorMessages,
              memorySnippet,
              provider,
              profileId,
              withTools,
              toolAllow,
              tools: autoTools,
              ...(session.memoryEnabled ? { memoryEnabled: session.memoryEnabled } : {}),
              ...(typeof options.cwd === "string" ? { cwd: options.cwd } : {}),
            }),
        );

        const toolCalls = runtimeResult.toolCalls ?? [];
        const toolResults = runtimeResult.toolResults ?? [];
        const toolError = toolsAdapter.firstToolErrorFromLogs(toolResults);

        if (toolResults.length > 0) {
          await withFailureMapping(
            "core.session.appendToolSummary",
            requestId,
            session.sessionKey,
            "SESSION_FAILURE",
            emitEvent,
            () =>
              sessionAdapter.appendToolSummary(
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
          requestId,
          session.sessionKey,
          "SESSION_FAILURE",
          emitEvent,
          () =>
            sessionAdapter.appendTurnMessages(
              session.sessionId,
              input,
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
          requestId,
          session.sessionKey,
          "SESSION_FAILURE",
          emitEvent,
          () =>
            sessionAdapter.markRouteUsage(
              session.sessionKey,
              runtimeResult.route,
              runtimeResult.profileId,
              runtimeResult.provider,
            ),
        );

        const memoryUpdated = await withFailureMapping(
          "core.session.compact",
          requestId,
          session.sessionKey,
          "SESSION_FAILURE",
          emitEvent,
          () =>
            sessionAdapter.compactIfNeeded({
              sessionKey: session.sessionKey,
              sessionId: session.sessionId,
              memoryEnabled: session.memoryEnabled,
              compactedMessageCount: session.compactedMessageCount,
            }),
        );

        if (toolError) {
          await emitEvent({
            level: "log",
            requestId,
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

        await emitEvent({
          level: "event",
          requestId,
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

        return {
          requestId,
          text: runtimeResult.result,
          sessionKey: session.sessionKey,
          sessionId: session.sessionId,
        };
      } catch (error) {
        const normalized = toValidationError(error, "INTERNAL_ERROR");
        await emitEvent({
          level: "log",
          requestId,
          at: nowIso(),
          code: normalized.code as CoreErrorCode,
          name: "agent.request.failed",
          stage: "agent.request",
          message: normalized.message,
          sessionKey,
          payload: {
            provider,
            profileId,
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
export type {
  CoreCoordinator,
  CoreErrorCode,
  CoreRunAgentOptions,
  CoreRuntimeInput,
  CoreRuntimeInput as CoreRuntimePayload,
} from "./contracts.js";
