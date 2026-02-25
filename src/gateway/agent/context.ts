import type { Message } from "@mariozechner/pi-ai";
import {
  ContextToolSpec,
  PromptAuditRecord,
  RequestContext,
  SessionHistoryMessage,
} from "../../shared/types.js";
import { OPENAI_CODEX_MODEL } from "../../auth/authManager.js";
import {
  buildAgentSystemPrompt,
  inspectWorkspaceContext,
  resolveWorkspaceDir,
} from "../../shared/workspaceContext.js";
import { ValidationError } from "../../shared/types.js";

export const DEFAULT_SESSION_KEY = "main";
export const DEFAULT_CONTEXT_MESSAGE_LIMIT = 12;
export const DEFAULT_TOOL_MAX_STEPS = 3;
export const NEW_SESSION_COMMAND = "/new";
export const NEW_SESSION_ROUTE = "system";
export const NEW_SESSION_STAGE = "gateway.new_session";
export const ASSISTANT_FOLLOWUP_PROMPT = "请基于上述工具结果回答问题。";

function nowTs() {
  return Date.now();
}

export function nowIso(): string {
  return new Date(nowTs()).toISOString();
}

export function createRequestId(): string {
  return `lc-${nowTs()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
}

export function createMessageId(prefix: string): string {
  return `${prefix}-${nowTs()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
}

export function toTimestamp(raw: string): number {
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : nowTs();
}

export function resolveSessionKey(rawSessionKey: string | undefined): string {
  const normalized = rawSessionKey?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_SESSION_KEY;
}

export function resolveToolMaxSteps(raw: number | undefined): number {
  if (typeof raw === "undefined") {
    return DEFAULT_TOOL_MAX_STEPS;
  }
  if (!Number.isInteger(raw) || raw < 1) {
    throw new ValidationError("tool max steps must be an integer >= 1", "INVALID_TOOL_MAX_STEPS");
  }
  return raw;
}

export function resolveMemoryFlag(value: boolean | undefined): boolean | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  return !!value;
}

export function trimContextMessages(messages: SessionHistoryMessage[]): SessionHistoryMessage[] {
  if (messages.length <= DEFAULT_CONTEXT_MESSAGE_LIMIT) {
    return messages;
  }
  return messages.slice(-DEFAULT_CONTEXT_MESSAGE_LIMIT);
}

export function normalizeToolAllow(raw: string[] | undefined): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  return raw
    .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
    .filter((entry) => entry.length > 0);
}

export async function buildWorkspaceSystemPrompt(cwd: string | undefined): Promise<string> {
  const workspaceContext = await inspectWorkspaceContext(resolveWorkspaceDir(cwd), nowIso());
  return buildAgentSystemPrompt(workspaceContext);
}

function makeUsageZero() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

export function contextMessagesFromHistory(messages: SessionHistoryMessage[]): Message[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: [{ type: "text", text: message.content }],
        api: "openai-codex-responses",
        provider: "openai-codex",
        model: OPENAI_CODEX_MODEL,
        usage: makeUsageZero(),
        stopReason: "stop",
        timestamp: toTimestamp(message.timestamp),
      } as Message;
    }

    return {
      role: "user",
      content: message.content,
      timestamp: toTimestamp(message.timestamp),
    } as Message;
  });
}

export function makeUserContextMessage(content: string): Message {
  return {
    role: "user",
    content,
    timestamp: nowTs(),
  } as Message;
}

export function makeBaseRequestContext(
  requestId: string,
  createdAt: string,
  input: string,
  sessionKey: string,
  sessionId: string,
  messages: Message[],
  provider?: string,
  profileId?: string,
  tools?: ContextToolSpec[],
  systemPrompt?: string,
  memoryEnabled: boolean = true,
): RequestContext {
  return {
    requestId,
    createdAt,
    input,
    sessionKey,
    sessionId,
    messages,
    ...(provider ? { provider } : {}),
    ...(profileId ? { profileId } : {}),
    ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
    ...(typeof systemPrompt === "string" && systemPrompt.trim().length > 0 ? { systemPrompt } : {}),
    memoryEnabled,
  };
}

export function buildPromptAuditRecord(
  step: number,
  requestContext: RequestContext,
  routeDecision?: string,
): PromptAuditRecord {
  const clonedMessages = JSON.parse(JSON.stringify(requestContext.messages)) as Message[];
  const clonedTools = Array.isArray(requestContext.tools) && requestContext.tools.length > 0
    ? (JSON.parse(JSON.stringify(requestContext.tools)) as ContextToolSpec[])
    : undefined;
  return {
    step,
    ...(typeof routeDecision === "string" && routeDecision.trim() ? { routeDecision } : {}),
    requestContext: {
      requestId: requestContext.requestId,
      createdAt: requestContext.createdAt,
      input: requestContext.input,
      sessionKey: requestContext.sessionKey,
      sessionId: requestContext.sessionId,
      ...(requestContext.provider ? { provider: requestContext.provider } : {}),
      ...(requestContext.profileId ? { profileId: requestContext.profileId } : {}),
      systemPrompt: requestContext.systemPrompt ?? "",
      messages: clonedMessages,
      ...(clonedTools ? { tools: clonedTools } : {}),
    },
  };
}
