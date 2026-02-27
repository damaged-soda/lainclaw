import { type SessionHistoryMessage } from "../shared/types.js";
import type { ToolCall, ToolExecutionLog } from "../tools/types.js";
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

const MEMORY_COMPACT_TRIGGER_MESSAGES = 24;
const MEMORY_KEEP_RECENT_MESSAGES = 12;
const MEMORY_MIN_COMPACT_WINDOW = 6;
const MEMORY_SUMMARY_MESSAGE_LIMIT = 16;
const MEMORY_SUMMARY_LINE_LIMIT = 120;
const DEFAULT_TOOL_MESSAGE_PREFIX = "msg-tool-context";
const DEFAULT_USER_MESSAGE_PREFIX = "msg-user";
const DEFAULT_ASSISTANT_MESSAGE_PREFIX = "msg-assistant";

export interface SessionRuntimeMessage {
  route: string;
  stage: string;
  provider: string;
  profileId: string;
}

export interface SessionTurnResult {
  route: string;
  stage: string;
  result: string;
  provider: string;
  profileId: string;
}

export interface SessionSnapshot extends SessionLoadResult {}

export interface SessionSnapshotCompact {
  sessionKey: string;
  sessionId: string;
  memoryEnabled: boolean;
  compactedMessageCount: number;
}

export interface SessionService {
  resolveSession(input: SessionLoadOptions): Promise<SessionSnapshot>;
  loadHistory(sessionId: string): Promise<SessionHistoryMessage[]>;
  loadMemorySnippet(sessionKey: string): Promise<string>;
  appendTurnMessages(sessionId: string, userInput: string, finalResult: SessionTurnResult): Promise<void>;
  appendToolSummary(
    sessionId: string,
    toolCalls: ToolCall[],
    toolResults: ToolExecutionLog[],
    route: string,
    stage: string,
    provider: string,
    profileId: string,
  ): Promise<void>;
  markRouteUsage(sessionKey: string, route: string, profileId: string, provider: string): Promise<void>;
  compactIfNeeded(session: SessionSnapshotCompact): Promise<boolean>;
  resolveSessionMemoryPath(sessionKey: string): string;
}

function nowIso() {
  return new Date().toISOString();
}

function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
}

function truncateText(raw: string, maxLength: number): string {
  const trimmed = raw.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
}

function toRouteContext(result: SessionRuntimeMessage): SessionRuntimeMessage {
  return {
    route: result.route,
    stage: result.stage,
    provider: result.provider,
    profileId: result.profileId,
  };
}

function buildToolMessages(calls: ToolCall[], results: ToolExecutionLog[]): string {
  const resultById = new Map<string, ToolExecutionLog>();
  const resultByName = new Map<string, ToolExecutionLog>();

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

export function buildCompactionSummary(
  messages: SessionHistoryMessage[],
  compactedMessageCount: number,
): string {
  const cutoff = Math.max(messages.length - MEMORY_KEEP_RECENT_MESSAGES, 0);
  const compactFrom = Math.max(0, Math.min(compactedMessageCount, cutoff));
  const candidates = messages
    .slice(compactFrom, cutoff)
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-MEMORY_SUMMARY_MESSAGE_LIMIT);

  if (candidates.length < MEMORY_MIN_COMPACT_WINDOW) {
    return "";
  }

  const lines = candidates.map((message) => `${message.role}: ${truncateText(message.content, MEMORY_SUMMARY_LINE_LIMIT)}`);
  return `## Memory Summary\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

async function appendRuntimeMessage(
  sessionId: string,
  role: "user" | "assistant" | "system",
  content: string,
  routeContext: SessionRuntimeMessage,
  messageIdPrefix: string,
): Promise<void> {
  await appendSessionMessage(sessionId, {
    id: createMessageId(messageIdPrefix),
    role,
    timestamp: nowIso(),
    content,
    route: routeContext.route,
    stage: routeContext.stage,
    provider: routeContext.provider,
    profileId: routeContext.profileId,
  });
}

function createSessionService(): SessionService {
  return {
    resolveSession: (input: SessionLoadOptions): Promise<SessionSnapshot> => getOrCreateSession(input),
    loadHistory: (sessionId: string): Promise<SessionHistoryMessage[]> => getRecentSessionMessages(sessionId),
    loadMemorySnippet: (sessionKey: string): Promise<string> => loadSessionMemorySnippet(sessionKey),
    appendTurnMessages: async (sessionId: string, userInput: string, finalResult: SessionTurnResult): Promise<void> => {
      const routeContext = toRouteContext(finalResult);
      await appendRuntimeMessage(sessionId, "user", userInput, routeContext, DEFAULT_USER_MESSAGE_PREFIX);
      await appendRuntimeMessage(sessionId, "assistant", finalResult.result, routeContext, DEFAULT_ASSISTANT_MESSAGE_PREFIX);
    },
    appendToolSummary: async (
      sessionId: string,
      toolCalls: ToolCall[],
      toolResults: ToolExecutionLog[],
      route: string,
      stage: string,
      provider: string,
      profileId: string,
    ): Promise<void> => {
      if (toolResults.length === 0) {
        return;
      }
      const toolSummary = buildToolMessages(toolCalls, toolResults);
      await appendRuntimeMessage(
        sessionId,
        "system",
        `toolResults:\n${toolSummary}`,
        {
          route,
          stage,
          provider,
          profileId,
        },
        DEFAULT_TOOL_MESSAGE_PREFIX,
      );
    },
    markRouteUsage: (
      sessionKey: string,
      route: string,
      profileId: string,
      provider: string,
    ): Promise<void> => recordSessionRoute(sessionKey, route, profileId, provider),
    compactIfNeeded: async (session: SessionSnapshotCompact): Promise<boolean> => {
      if (!session.memoryEnabled) {
        return false;
      }

      const allMessages = await getAllSessionMessages(session.sessionId);
      if (allMessages.length <= MEMORY_COMPACT_TRIGGER_MESSAGES) {
        return false;
      }

      const summary = buildCompactionSummary(allMessages, session.compactedMessageCount);
      if (!summary) {
        return false;
      }

      await appendSessionMemory(session.sessionKey, session.sessionId, summary);
      const cutoff = Math.max(allMessages.length - MEMORY_KEEP_RECENT_MESSAGES, 0);
      await updateSessionRecord(session.sessionKey, { compactedMessageCount: cutoff });
      return true;
    },
    resolveSessionMemoryPath,
  };
}

function resolveSessionMemoryPath(sessionKey: string): string {
  return getSessionMemoryPath(sessionKey);
}

export const sessionService = createSessionService();
