import type { AgentMessage } from "@mariozechner/pi-agent-core";
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
import { writeDebugLogIfEnabled } from "../shared/debug.js";

export const DEFAULT_CONTEXT_MESSAGE_LIMIT = 12;
export const MEMORY_CONTEXT_PREFIX = "[memory]\n";

export interface RuntimeMemoryContextMessage {
  role: "context_memory";
  content: string;
  timestamp: number;
}

declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    runtimeMemoryContext: RuntimeMemoryContextMessage;
  }
}

interface RuntimeContextMessages {
  requestContext: RequestContext;
  transcriptMessages: Message[];
  promptMessage?: Message;
}

function isLlmCompatibleMessage(message: AgentMessage): message is Message {
  if (!message || typeof message !== "object") {
    return false;
  }
  const candidate = message as { role?: unknown };
  return (
    candidate.role === "user" ||
    candidate.role === "assistant" ||
    candidate.role === "toolResult"
  );
}

export function isRuntimeMemoryContextMessage(
  message: AgentMessage,
): message is RuntimeMemoryContextMessage {
  if (!message || typeof message !== "object") {
    return false;
  }
  const candidate = message as { role?: unknown; content?: unknown };
  return candidate.role === "context_memory" && typeof candidate.content === "string";
}

export async function transformContextMessages(params: {
  requestContext: Pick<
    RequestContext,
    | "requestId"
    | "sessionKey"
    | "sessionId"
    | "provider"
    | "profileId"
    | "memoryEnabled"
    | "memorySnippet"
    | "contextMessageLimit"
    | "debug"
  >;
  messages: AgentMessage[];
}): Promise<AgentMessage[]> {
  const compatibleMessages = params.messages.filter(isLlmCompatibleMessage);
  const trimmedMessages = trimAgentContextMessages(
    compatibleMessages,
    params.requestContext.contextMessageLimit,
  );
  const memoryMessage = makeMemoryContextMessage(
    params.requestContext.memoryEnabled !== false ? params.requestContext.memorySnippet : undefined,
  );
  const transformed = memoryMessage ? [memoryMessage, ...trimmedMessages] : trimmedMessages;

  writeDebugLogIfEnabled(params.requestContext.debug, "runtime.context.transform_applied", {
    requestId: params.requestContext.requestId,
    sessionKey: params.requestContext.sessionKey,
    sessionId: params.requestContext.sessionId,
    provider: params.requestContext.provider,
    profileId: params.requestContext.profileId,
    originalMessageCount: compatibleMessages.length,
    finalMessageCount: transformed.length,
    trimmedMessageCount: Math.max(compatibleMessages.length - trimmedMessages.length, 0),
    memoryInjected: Boolean(memoryMessage),
    contextMessageLimit: params.requestContext.contextMessageLimit,
  });

  return transformed;
}

// Core flow: transcript fallback 与主流程入参准备
export function buildRuntimeRequestContext(params: {
  requestId: string;
  createdAt: string;
  input: string;
  sessionKey: string;
  sessionId: string;
  transcriptMessages: SessionHistoryMessage[];
  memorySnippet?: string;
  provider: string;
  profileId: string;
  withTools: boolean;
  tools?: ContextToolSpec[];
  systemPrompt?: string;
  runMode?: RequestContext["runMode"];
  continueReason?: RequestContext["continueReason"];
  memoryEnabled?: boolean;
  contextMessageLimit?: number;
  debug?: boolean;
}): RuntimeContextMessages {
  const resolvedTools = params.withTools && Array.isArray(params.tools) ? params.tools : undefined;
  const provider = params.provider.trim();
  const contextMessageLimit = Math.max(
    1,
    params.contextMessageLimit ?? DEFAULT_CONTEXT_MESSAGE_LIMIT,
  );
  const transcriptMessages = contextMessagesFromHistory(
    trimTranscriptMessages(params.transcriptMessages, contextMessageLimit),
    provider,
  );
  const runMode = params.runMode ?? "prompt";

  if (transcriptMessages.length > 0) {
    writeDebugLogIfEnabled(params.debug, "runtime.context.transcript_attached", {
      requestId: params.requestId,
      sessionKey: params.sessionKey,
      provider,
      profileId: params.profileId,
      count: transcriptMessages.length,
      messages: transcriptMessages,
    });
  }

  if (typeof params.memorySnippet === "string" && params.memorySnippet.length > 0) {
    writeDebugLogIfEnabled(params.debug, "runtime.context.memory_loaded", {
      requestId: params.requestId,
      sessionKey: params.sessionKey,
      provider,
      profileId: params.profileId,
      length: params.memorySnippet.length,
    });
  }

  const promptMessage = runMode === "prompt" ? makeUserContextMessage(params.input) : undefined;
  if (promptMessage) {
    writeDebugLogIfEnabled(params.debug, "runtime.context.user_input_attached", {
      requestId: params.requestId,
      sessionKey: params.sessionKey,
      provider,
      profileId: params.profileId,
      message: promptMessage,
    });
  }

  const requestContext = makeBaseRequestContext(
    params.requestId,
    params.createdAt,
    params.input,
    params.sessionKey,
    params.sessionId,
    transcriptMessages,
    provider,
    params.profileId,
    resolvedTools,
    params.systemPrompt,
    params.memorySnippet,
    contextMessageLimit,
    runMode,
    params.continueReason,
    params.memoryEnabled ?? true,
    params.debug === true,
  );

  if (typeof requestContext.systemPrompt === "string" && requestContext.systemPrompt.length > 0) {
    writeDebugLogIfEnabled(params.debug, "runtime.context.system_prompt_attached", {
      requestId: params.requestId,
      sessionKey: params.sessionKey,
      provider,
      profileId: params.profileId,
      systemPrompt: requestContext.systemPrompt,
    });
  }

  writeDebugLogIfEnabled(params.debug, "runtime.context.request_built", {
    requestId: params.requestId,
    sessionKey: params.sessionKey,
    provider,
    profileId: params.profileId,
    runMode,
    requestContext,
  });

  return { requestContext, transcriptMessages, promptMessage };
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

export function trimTranscriptMessages(
  messages: SessionHistoryMessage[],
  limit: number = DEFAULT_CONTEXT_MESSAGE_LIMIT,
): SessionHistoryMessage[] {
  if (messages.length <= limit) {
    return messages;
  }
  return messages.slice(-limit);
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

export function makeMemoryContextMessage(
  content: string | undefined,
): RuntimeMemoryContextMessage | undefined {
  if (typeof content !== "string" || content.trim().length === 0) {
    return undefined;
  }
  return {
    role: "context_memory",
    content,
    timestamp: nowTs(),
  };
}

export function trimAgentContextMessages(
  messages: Message[],
  limit: number = DEFAULT_CONTEXT_MESSAGE_LIMIT,
): Message[] {
  if (messages.length <= limit) {
    return messages;
  }
  return messages.slice(-limit);
}

export function convertAgentMessagesToLlm(messages: AgentMessage[]): Message[] {
  return messages.flatMap((message) => {
    if (isLlmCompatibleMessage(message)) {
      return [message];
    }
    if (isRuntimeMemoryContextMessage(message)) {
      return [{
        role: "user",
        content: `${MEMORY_CONTEXT_PREFIX}${message.content}`,
        timestamp: message.timestamp,
      } as Message];
    }
    return [];
  });
}

export function makeBaseRequestContext(
  requestId: string,
  createdAt: string,
  input: string,
  sessionKey: string,
  sessionId: string,
  transcriptMessages: Message[],
  provider: string,
  profileId: string,
  tools?: ContextToolSpec[],
  systemPrompt?: string,
  memorySnippet?: string,
  contextMessageLimit: number = DEFAULT_CONTEXT_MESSAGE_LIMIT,
  runMode: RequestContext["runMode"] = "prompt",
  continueReason?: RequestContext["continueReason"],
  memoryEnabled: boolean = true,
  debug = false,
): RequestContext {
  return {
    requestId,
    createdAt,
    input,
    sessionKey,
    sessionId,
    transcriptMessages,
    ...(typeof memorySnippet === "string" && memorySnippet.length > 0 ? { memorySnippet } : {}),
    contextMessageLimit,
    provider,
    profileId,
    runMode,
    ...(continueReason ? { continueReason } : {}),
    ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
    ...(typeof systemPrompt === "string" && systemPrompt.trim().length > 0 ? { systemPrompt } : {}),
    memoryEnabled,
    ...(debug ? { debug: true } : {}),
  };
}
