import {
  appendSessionMessage,
  getOrCreateSession,
  getRecentSessionTranscriptMessages,
  getSessionMemoryPath,
  loadSessionMemorySnippet,
  recordSessionRoute,
  type SessionLoadOptions,
  type SessionLoadResult,
} from "./sessionStore.js";
import { sessionMemoryCompactor, type SessionMemoryCompactor } from "./memoryCompactor.js";
import { ValidationError } from "../shared/types.js";
import type {
  CoreSessionLoadInput,
  CoreSessionPort,
  CoreSessionRecord,
  CoreSessionSnapshotCompact,
  CoreSessionTurnResult,
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
  role: "user" | "assistant",
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

export interface CreateSessionAdapterOptions {
  memoryCompactor?: SessionMemoryCompactor;
}

export function createSessionAdapter(options: CreateSessionAdapterOptions = {}): CoreSessionPort {
  const memoryCompactor = options.memoryCompactor ?? sessionMemoryCompactor;
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
    loadTranscriptMessages: (sessionId: string): Promise<SessionHistoryMessage[]> => {
      return runWithSessionFailure(
        async () => getRecentSessionTranscriptMessages(sessionId),
      );
    },
    loadMemorySnippet: (sessionKey: string): Promise<string> => {
      return runWithSessionFailure(async () => loadSessionMemorySnippet(sessionKey));
    },
    appendTurnMessages: async (
      sessionId: string,
      userInput: string,
      finalResult: CoreSessionTurnResult,
      options?: {
        includeUserMessage?: boolean;
      },
    ): Promise<void> => {
      await runWithSessionFailure(async () => {
        if (options?.includeUserMessage !== false) {
          await appendRuntimeMessage(sessionId, "user", userInput, finalResult, "msg-user");
        }
        await appendRuntimeMessage(sessionId, "assistant", finalResult.result, finalResult, "msg-assistant");
      });
    },
    markRouteUsage: (sessionKey: string, route: string, profileId: string, provider: string): Promise<void> => {
      return runWithSessionFailure(async () =>
        recordSessionRoute(sessionKey, route, profileId, provider),
      );
    },
    compactIfNeeded: async (input: CoreSessionSnapshotCompact): Promise<boolean> => {
      return runWithSessionFailure(async () => memoryCompactor.compactIfNeeded(input));
    },
    resolveSessionMemoryPath: (sessionKey: string): string => {
      return getSessionMemoryPath(sessionKey);
    },
  };
}
