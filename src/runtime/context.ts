import type { Message } from "@mariozechner/pi-ai";
import {
  ContextToolSpec,
  RequestContext,
  SessionHistoryMessage,
} from "../shared/types.js";
import {
  buildAgentSystemPrompt,
  inspectWorkspaceContext,
  resolveWorkspaceDir,
} from "../shared/workspaceContext.js";

export const DEFAULT_CONTEXT_MESSAGE_LIMIT = 12;

interface RuntimeContextMessages {
  requestContext: RequestContext;
  contextMessages: Message[];
  historyContext: Message[];
}

// Core flow: 上下文构建与主流程入参准备
export function buildRuntimeRequestContext(params: {
  requestId: string;
  createdAt: string;
  input: string;
  sessionKey: string;
  sessionId: string;
  priorMessages: SessionHistoryMessage[];
  memorySnippet?: string;
  provider: string;
  profileId: string;
  withTools: boolean;
  tools?: ContextToolSpec[];
  systemPrompt?: string;
  memoryEnabled?: boolean;
}): RuntimeContextMessages {
  const resolvedTools = params.withTools && Array.isArray(params.tools) ? params.tools : undefined;
  const provider = params.provider.trim();
  const historyContext = contextMessagesFromHistory(
    trimContextMessages(params.priorMessages),
    provider,
  );
  const contextMessages: Message[] = [...historyContext];

  if (typeof params.memorySnippet === "string" && params.memorySnippet.length > 0) {
    contextMessages.push(makeUserContextMessage(`[memory]\n${params.memorySnippet}`));
  }

  contextMessages.push(makeUserContextMessage(params.input));

  const requestContext = makeBaseRequestContext(
    params.requestId,
    params.createdAt,
    params.input,
    params.sessionKey,
    params.sessionId,
    contextMessages,
    provider,
    params.profileId,
    resolvedTools,
    params.systemPrompt,
    params.memoryEnabled ?? true,
  );

  return { requestContext, contextMessages, historyContext };
}

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

export function trimContextMessages(messages: SessionHistoryMessage[]): SessionHistoryMessage[] {
  if (messages.length <= DEFAULT_CONTEXT_MESSAGE_LIMIT) {
    return messages;
  }
  return messages.slice(-DEFAULT_CONTEXT_MESSAGE_LIMIT);
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

export function contextMessagesFromHistory(
  messages: SessionHistoryMessage[],
  provider: string,
): Message[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: [{ type: "text", text: message.content }],
        api: `${provider}-responses`,
        provider,
        model: `${provider}-model`,
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
  provider: string,
  profileId: string,
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
    provider,
    profileId,
    ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
    ...(typeof systemPrompt === "string" && systemPrompt.trim().length > 0 ? { systemPrompt } : {}),
    memoryEnabled,
  };
}
