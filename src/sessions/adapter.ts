import {
  appendSessionMessage,
  appendSessionMemory,
  getAllSessionMessages,
  getOrCreateSession,
  getRecentSessionMessages,
  getSessionMemoryPath,
  loadSessionMemorySnippet,
  recordSessionRoute,
  updateSessionRecord,
  type SessionLoadOptions,
  type SessionLoadResult,
} from "./sessionStore.js";
import { ValidationError } from "../shared/types.js";
import type {
  CoreSessionHistoryMessage,
  CoreSessionLoadInput,
  CoreSessionPort,
  CoreSessionRecord,
  CoreSessionSnapshotCompact,
  CoreSessionTurnResult,
  CoreToolCall,
  CoreToolExecutionLog,
} from "../core/contracts.js";
import type { SessionHistoryMessage } from "../shared/types.js";

function toCoreSessionRecord(raw: SessionLoadResult): CoreSessionRecord {
  return {
    sessionKey: raw.sessionKey,
    sessionId: raw.sessionId,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    isNewSession: raw.isNewSession,
    memoryEnabled: raw.memoryEnabled,
    compactedMessageCount: raw.compactedMessageCount,
  };
}

function toCoreHistoryMessage(item: SessionHistoryMessage): CoreSessionHistoryMessage {
  return {
    id: item.id,
    role: item.role,
    timestamp: item.timestamp,
    content: item.content,
  };
}

function buildToolMessages(calls: CoreToolCall[], results: CoreToolExecutionLog[]): string {
  const resultById = new Map<string, CoreToolExecutionLog>();
  const resultByName = new Map<string, CoreToolExecutionLog>();

  for (const result of results) {
    resultById.set(result.call.id, result);
    if (!resultByName.has(result.call.name)) {
      resultByName.set(result.call.name, result);
    }
  }

  const normalized = calls.map((call) => {
    const matched = resultById.get(call.id) || resultByName.get(call.name);
    if (!matched) {
      return {
        call,
        result: {
          ok: false,
          error: {
            code: "execution_error",
            tool: call.name,
            message: "tool result missing",
          },
        },
      };
    }

    return {
      call: matched.call,
      result: matched.result,
    };
  });

  return JSON.stringify(normalized, null, 2);
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeSessionError(error: unknown): ValidationError {
  if (error instanceof ValidationError) {
    if (error.code === "SESSION_FAILURE" || error.code === "INTERNAL_ERROR" || error.code === "VALIDATION_ERROR") {
      return error;
    }
    return new ValidationError(error.message, "SESSION_FAILURE");
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ValidationError(message || "session adapter failed", "SESSION_FAILURE");
}

async function runWithSessionFailure<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw normalizeSessionError(error);
  }
}

function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
}

async function appendRuntimeMessage(
  sessionId: string,
  role: "user" | "assistant" | "system",
  content: string,
  context: CoreSessionTurnResult,
  messageIdPrefix: string,
): Promise<void> {
  await appendSessionMessage(sessionId, {
    id: randomId(messageIdPrefix),
    role,
    timestamp: nowIso(),
    content,
    route: context.route,
    stage: context.stage,
    provider: context.provider,
    profileId: context.profileId,
  });
}

export function createSessionAdapter(): CoreSessionPort {
  return {
    resolveSession: async (input: CoreSessionLoadInput): Promise<CoreSessionRecord> => {
      return runWithSessionFailure(async () => {
        const rawInput: SessionLoadOptions = {
          sessionKey: input.sessionKey,
          provider: input.provider,
          profileId: input.profileId,
          ...(typeof input.forceNew === "boolean" ? { forceNew: input.forceNew } : {}),
          ...(typeof input.memory === "boolean" ? { memory: input.memory } : {}),
        };
        const snapshot = await getOrCreateSession(rawInput);
        return toCoreSessionRecord(snapshot);
      });
    },
    loadHistory: (sessionId: string): Promise<CoreSessionHistoryMessage[]> => {
      return runWithSessionFailure(
        async () => getRecentSessionMessages(sessionId).then((messages) => messages.map(toCoreHistoryMessage)),
      );
    },
    loadMemorySnippet: (sessionKey: string): Promise<string> => {
      return runWithSessionFailure(async () => loadSessionMemorySnippet(sessionKey));
    },
    appendTurnMessages: async (
      sessionId: string,
      userInput: string,
      finalResult: CoreSessionTurnResult,
    ): Promise<void> => {
      await runWithSessionFailure(async () => {
        await appendRuntimeMessage(sessionId, "user", userInput, finalResult, "msg-user");
        await appendRuntimeMessage(sessionId, "assistant", finalResult.result, finalResult, "msg-assistant");
      });
    },
    appendToolSummary: async (
      sessionId: string,
      toolCalls: CoreToolCall[],
      toolResults: CoreToolExecutionLog[],
      route: string,
      stage: string,
      provider: string,
      profileId: string,
    ): Promise<void> => {
      await runWithSessionFailure(async () => {
        if (toolResults.length === 0) {
          return;
        }
        const summary = buildToolMessages(toolCalls, toolResults);
        await appendRuntimeMessage(
          sessionId,
          "system",
          `toolResults:\n${summary}`,
          {
            route,
            stage,
            result: "tool summary",
            provider,
            profileId,
          },
          "msg-tool-context",
        );
      });
    },
    markRouteUsage: (sessionKey: string, route: string, profileId: string, provider: string): Promise<void> => {
      return runWithSessionFailure(async () =>
        recordSessionRoute(sessionKey, route, profileId, provider),
      );
    },
    compactIfNeeded: async (input: CoreSessionSnapshotCompact): Promise<boolean> => {
      return runWithSessionFailure(async () => {
        if (!input.memoryEnabled) {
          return false;
        }

        const allMessages = await getAllSessionMessages(input.sessionId);
        if (allMessages.length <= 24) {
          return false;
        }

        const summaryLines = allMessages
          .filter((message) => message.role === "user" || message.role === "assistant")
          .slice(-16)
          .map((message) => message.content)
          .filter((line) => line.length > 0)
          .map((line, index) => `${index + 1}. ${line}`);

        if (summaryLines.length < 6) {
          return false;
        }

        const summary = `## Memory Summary\n${summaryLines.map((line) => `- ${line}`).join("\n")}`;
        await appendSessionMemory(input.sessionKey, input.sessionId, summary);
        const cutoff = Math.max(allMessages.length - 12, 0);
        await updateSessionRecord(input.sessionKey, { compactedMessageCount: cutoff });
        return true;
      });
    },
    resolveSessionMemoryPath: (sessionKey: string): string => {
      return getSessionMemoryPath(sessionKey);
    },
  };
}
