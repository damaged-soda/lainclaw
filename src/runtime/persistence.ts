import type { SessionHistoryMessage } from "../shared/types.js";
import type { AdapterResult } from "../adapters/stubAdapter.js";
import type { ToolCall, ToolExecutionLog } from "../tools/types.js";
import {
  appendSessionMessage,
  appendSessionMemory,
  getAllSessionMessages,
  getSessionMemoryPath,
  recordSessionRoute,
  updateSessionRecord,
} from "../sessions/sessionStore.js";
import { createMessageId } from "./context.js";
import { buildToolMessages } from "./tools.js";

const MEMORY_COMPACT_TRIGGER_MESSAGES = 24;
const MEMORY_KEEP_RECENT_MESSAGES = 12;
const MEMORY_MIN_COMPACT_WINDOW = 6;
const MEMORY_SUMMARY_MESSAGE_LIMIT = 16;
const MEMORY_SUMMARY_LINE_LIMIT = 120;

function truncateText(raw: string, maxLength: number): string {
  const trimmed = raw.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
}

export function buildCompactionSummary(messages: SessionHistoryMessage[], compactedMessageCount: number): string {
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

export async function appendToolSummaryToHistory(
  sessionId: string,
  toolCalls: ToolCall[],
  toolResults: ToolExecutionLog[],
  route: string,
  stage: string,
  provider?: string,
  profileId?: string,
): Promise<void> {
  if (toolResults.length === 0) {
    return;
  }

  const toolSummary = buildToolMessages(toolCalls, toolResults);
  await appendSessionMessage(sessionId, {
    id: createMessageId("msg-tool-context"),
    role: "system",
    timestamp: new Date().toISOString(),
    content: `toolResults:\n${toolSummary}`,
    route,
    stage,
    ...(provider ? { provider } : {}),
    ...(profileId ? { profileId } : {}),
  });
}

export async function appendTurnMessages(
  sessionId: string,
  userInput: string,
  finalResult: AdapterResult,
): Promise<void> {
  await appendSessionMessage(sessionId, {
    id: createMessageId("msg-user"),
    role: "user",
    timestamp: new Date().toISOString(),
    content: userInput,
    route: finalResult.route,
    stage: finalResult.stage,
    ...(finalResult.provider ? { provider: finalResult.provider } : {}),
    ...(finalResult.profileId ? { profileId: finalResult.profileId } : {}),
  });
  await appendSessionMessage(sessionId, {
    id: createMessageId("msg-assistant"),
    role: "assistant",
    timestamp: new Date().toISOString(),
    content: finalResult.result,
    route: finalResult.route,
    stage: finalResult.stage,
    ...(finalResult.provider ? { provider: finalResult.provider } : {}),
    ...(finalResult.profileId ? { profileId: finalResult.profileId } : {}),
  });
}

export async function persistRouteUsage(sessionKey: string, finalResult: AdapterResult): Promise<void> {
  await recordSessionRoute(sessionKey, finalResult.route, finalResult.profileId, finalResult.provider);
}

export async function compactSessionMemoryIfNeeded(session: {
  sessionKey: string;
  sessionId: string;
  memoryEnabled: boolean;
  compactedMessageCount: number;
}): Promise<boolean> {
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
}

export function resolveSessionMemoryPath(sessionKey: string): string {
  return getSessionMemoryPath(sessionKey);
}
