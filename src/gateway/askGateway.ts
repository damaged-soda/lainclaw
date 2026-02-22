import type { Message } from "@mariozechner/pi-ai";
import {
  ContextToolSpec,
  GatewayResult,
  RequestContext,
  SessionHistoryMessage,
  ValidationError,
} from "../shared/types.js";
import type { AdapterResult } from "../adapters/stubAdapter.js";
import { runPipeline } from "../pipeline/pipeline.js";
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
} from "../sessions/sessionStore.js";
import type { ToolCall, ToolContext, ToolExecutionLog, ToolError } from "../tools/types.js";
import { getToolInfo, invokeToolsForAsk, listToolsCatalog } from "../tools/gateway.js";
import { isToolAllowed } from "../tools/registry.js";
import { OPENAI_CODEX_MODEL } from "../auth/authManager.js";

const DEFAULT_SESSION_KEY = "main";
const DEFAULT_CONTEXT_MESSAGE_LIMIT = 12;
const MEMORY_COMPACT_TRIGGER_MESSAGES = 24;
const MEMORY_KEEP_RECENT_MESSAGES = 12;
const MEMORY_MIN_COMPACT_WINDOW = 6;
const MEMORY_SUMMARY_MESSAGE_LIMIT = 16;
const MEMORY_SUMMARY_LINE_LIMIT = 120;
const TOOL_PARSE_PREFIX = "tool:";
const DEFAULT_TOOL_MAX_STEPS = 3;
const ASSISTANT_FOLLOWUP_PROMPT = "请基于上述工具结果回答问题。";

interface DeniedToolCall {
  call: ToolCall;
  code: ToolError["code"];
  message: string;
}

interface ToolLoopState {
  roundCalls: ToolCall[];
  roundResults: ToolExecutionLog[];
}

interface ParseToolInput {
  toolCalls: ToolCall[];
  residualInput: string;
  parseError?: string;
}

function createRequestId() {
  const now = Date.now();
  const suffix = Math.floor(Math.random() * 10000).toString(16).padStart(4, "0");
  return `lc-${now}-${suffix}`;
}

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function nowTs() {
  return Date.now();
}

function toTimestamp(raw: string): number {
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : nowTs();
}

function resolveSessionKey(rawSessionKey: string | undefined): string {
  const normalized = rawSessionKey?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_SESSION_KEY;
}

function resolveToolMaxSteps(raw: number | undefined): number {
  if (typeof raw === "undefined") {
    return DEFAULT_TOOL_MAX_STEPS;
  }
  if (!Number.isInteger(raw) || raw < 1) {
    throw new ValidationError("tool max steps must be an integer >= 1", "INVALID_TOOL_MAX_STEPS");
  }
  return raw;
}

function clampMemoryFlag(value: boolean | undefined): boolean | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  return !!value;
}

function trimContextMessages(messages: SessionHistoryMessage[]): SessionHistoryMessage[] {
  if (messages.length <= DEFAULT_CONTEXT_MESSAGE_LIMIT) {
    return messages;
  }
  return messages.slice(-DEFAULT_CONTEXT_MESSAGE_LIMIT);
}

function truncateText(raw: string, maxLength: number): string {
  const trimmed = raw.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
}

function buildCompactionSummary(messages: SessionHistoryMessage[], compactedMessageCount: number): string {
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

function normalizeToolAllow(raw: string[] | undefined): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  return raw
    .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
    .filter((entry) => entry.length > 0);
}

function parseToolCallsFromPrompt(rawInput: string): ParseToolInput {
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith(TOOL_PARSE_PREFIX)) {
    return {
      toolCalls: [],
      residualInput: rawInput,
    };
  }

  const payload = trimmed.slice(TOOL_PARSE_PREFIX.length).trim();
  if (!payload) {
    return {
      toolCalls: [],
      residualInput: "",
      parseError: "tool invocation missing content",
    };
  }

  let command = payload;
  let residualInput = "";
  const separator = payload.indexOf("\n");
  if (separator >= 0) {
    command = payload.slice(0, separator).trim();
    residualInput = payload.slice(separator + 1).trim();
  }

  if (!command) {
    return {
      toolCalls: [],
      residualInput,
      parseError: "tool invocation missing call payload",
    };
  }

  try {
    let entries: unknown[] = [];
    if (command.startsWith("[") || command.startsWith("{")) {
      const parsed = JSON.parse(command);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      if (list.length === 0) {
        return {
          toolCalls: [],
          residualInput,
          parseError: "tool invocation array is empty",
        };
      }
      entries = list;
    } else {
      const firstSpace = command.search(/\s/);
      const name = firstSpace >= 0 ? command.slice(0, firstSpace).trim() : command;
      const argsText = firstSpace >= 0 ? command.slice(firstSpace + 1).trim() : "";
      const args = argsText ? JSON.parse(argsText) : {};
      entries = [{ name, args }];
    }

    const toolCalls = entries.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`tool invocation #${index + 1} is invalid`);
      }

      const normalized = entry as Partial<ToolCall>;
      const name = typeof normalized.name === "string" ? normalized.name.trim() : "";
      if (!name) {
        throw new Error(`tool invocation #${index + 1} missing name`);
      }

      return {
        id:
          typeof normalized.id === "string" && normalized.id.trim().length > 0
            ? normalized.id.trim()
            : `tool-${Date.now()}-${index + 1}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`,
        name,
        args: normalized.args,
        source: "ask",
      };
    });

    return {
      toolCalls,
      residualInput,
    };
  } catch (error) {
    return {
      toolCalls: [],
      residualInput,
      parseError: error instanceof Error ? error.message : "invalid tool payload",
    };
  }
}

function normalizeToolCall(call: ToolCall): ToolCall {
  return {
    ...call,
    id:
      typeof call.id === "string" && call.id.trim().length > 0
        ? call.id.trim()
        : `tool-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`,
    name: call.name.trim(),
  };
}

function makeToolExecutionError(call: ToolCall, message: string, code: ToolError["code"]): ToolExecutionLog {
  const normalized = normalizeToolCall(call);
  return {
    call: normalized,
    result: {
      ok: false,
      content: undefined,
      error: {
        tool: normalized.name,
        code,
        message,
      },
      meta: {
        tool: normalized.name,
        durationMs: 0,
      },
    },
  };
}

function chooseFirstToolError(first: ToolError | undefined, next: ToolError | undefined): ToolError | undefined {
  if (first) {
    return first;
  }
  return next;
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

function contextMessagesFromHistory(messages: SessionHistoryMessage[]): Message[] {
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

function makeUserContextMessage(content: string): Message {
  return {
    role: "user",
    content,
    timestamp: nowTs(),
  };
}

function toCodexToolName(raw: string): string {
  const normalized = raw.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return normalized.length > 0 ? normalized : `tool-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
}

function makeAssistantToolContextMessage(
  calls: ToolCall[],
  resultText: string,
  stopReason?: string,
  provider?: string,
): Message {
  const shouldSanitize = provider === "openai-codex";
  return {
    role: "assistant",
    content: [
      ...(resultText ? [{ type: "text", text: resultText }] : []),
      ...calls.map((call) => ({
        type: "toolCall",
        id: call.id,
        name: shouldSanitize ? toCodexToolName(call.name) : call.name,
        arguments: call.args,
      })),
    ],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: OPENAI_CODEX_MODEL,
    usage: makeUsageZero(),
    stopReason: stopReason ?? "toolUse",
    timestamp: nowTs(),
  } as Message;
}

function makeToolResultContextMessage(log: ToolExecutionLog): Message {
  const normalizedResult = log.result.ok
    ? log.result.content
    : log.result.error
      ? log.result.error.message
      : "tool execution failed";
  return {
    role: "toolResult" as const,
    toolCallId: log.call.id,
    toolName: log.call.name,
    content: [{ type: "text", text: `${normalizedResult ?? ""}` }],
    isError: !log.result.ok,
    timestamp: nowTs(),
  } as Message;
}

function buildToolMessages(calls: ToolCall[], results: ToolExecutionLog[]): string {
  const normalized = calls.map((call) => {
    const matched = results.find((result) => result.call.id === call.id || result.call.name === call.name);
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

function makeBaseRequestContext(
  requestId: string,
  createdAt: string,
  input: string,
  sessionKey: string,
  sessionId: string,
  messages: Message[],
  provider?: string,
  profileId?: string,
  tools?: ContextToolSpec[],
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
    memoryEnabled,
  };
}

function classifyToolCalls(calls: ToolCall[], toolAllow: string[]): {
  allowed: ToolCall[];
  denied: DeniedToolCall[];
} {
  return calls.reduce(
    (acc, call) => {
      const normalized = normalizeToolCall(call);
      const name = normalized.name;
      if (!isToolAllowed(name, toolAllow)) {
        acc.denied.push({
          call: normalized,
          code: "tool_not_found",
          message: `tool not allowed: ${name}`,
        });
        return acc;
      }
      if (!getToolInfo(name, toolAllow)) {
        acc.denied.push({
          call: normalized,
          code: "tool_not_found",
          message: `tool not found: ${name}`,
        });
        return acc;
      }
      acc.allowed.push(normalized);
      return acc;
    },
    { allowed: [], denied: [] } as { allowed: ToolCall[]; denied: DeniedToolCall[] },
  );
}

async function executeAllowedToolCalls(
  requestId: string,
  sessionId: string,
  sessionKey: string,
  calls: ToolCall[],
): Promise<{ logs: ToolExecutionLog[]; toolError?: ToolError }> {
  if (calls.length === 0) {
    return { logs: [], toolError: undefined };
  }

  const toolContext: ToolContext = {
    requestId,
    sessionId,
    sessionKey,
    cwd: process.cwd(),
  };
  const logs = await invokeToolsForAsk(calls, toolContext);
  const firstError = logs.find((log) => log.result.error)?.result.error;
  return { logs, toolError: firstError };
}

function appendToolCallContextMessages(
  requestMessages: Message[],
  round: ToolLoopState,
  resultText: string,
  stopReason?: string,
  provider?: string,
): void {
  requestMessages.push(makeAssistantToolContextMessage(round.roundCalls, resultText, stopReason, provider));
  requestMessages.push(...round.roundResults.map(makeToolResultContextMessage));
}

function resolveStepLimitError(toolCalls: ToolCall[], toolMaxSteps: number): ToolError {
  const tool = toolCalls[0]?.name ?? "unknown";
  return {
    tool,
    code: "execution_error",
    message: `tool call loop exceeded max steps (${toolMaxSteps})`,
  };
}

export async function runAsk(
  rawInput: string,
  opts: {
    provider?: string;
    profileId?: string;
    sessionKey?: string;
    newSession?: boolean;
    memory?: boolean;
    withTools?: boolean;
    toolAllow?: string[];
    toolMaxSteps?: number;
  } = {},
): Promise<GatewayResult> {
  if (!rawInput || !rawInput.trim()) {
    throw new ValidationError("ask command requires non-empty input", "ASK_INPUT_REQUIRED");
  }

  const input = rawInput.trim();
  const sessionKey = resolveSessionKey(opts.sessionKey);
  const provider = opts.provider?.trim();
  const profileId = opts.profileId?.trim();
  const memoryEnabled = clampMemoryFlag(opts.memory);
  const withTools = typeof opts.withTools === "boolean" ? opts.withTools : true;
  const toolAllow = normalizeToolAllow(opts.toolAllow);
  const toolMaxSteps = resolveToolMaxSteps(opts.toolMaxSteps);

  const session = await getOrCreateSession({
    sessionKey,
    provider,
    profileId,
    forceNew: !!opts.newSession,
    ...(typeof memoryEnabled === "boolean" ? { memory: memoryEnabled } : {}),
  });

  const memorySnippet = session.memoryEnabled ? await loadSessionMemorySnippet(session.sessionKey) : "";
  const priorMessages = trimContextMessages(await getRecentSessionMessages(session.sessionId));
  const requestId = createRequestId();
  const createdAt = nowIso();

  const historyContext: Message[] = contextMessagesFromHistory(priorMessages);
  if (memorySnippet) {
    historyContext.push({
      role: "user",
      content: `[memory]\n${memorySnippet}`,
      timestamp: nowTs(),
    });
  }

  const parsedToolInput = parseToolCallsFromPrompt(input);
  const manualToolPath = parsedToolInput.toolCalls.length > 0 || !!parsedToolInput.parseError;
  const toolAllowForSession = toolAllow;

  const toolCalls: ToolCall[] = [];
  const toolResults: ToolExecutionLog[] = [];
  let toolError: ToolError | undefined;
  let sessionContextUpdated = false;
  let finalResult: AdapterResult | undefined;
  let finalUserContextInput = input;

  if (manualToolPath) {
    const split = classifyToolCalls(parsedToolInput.toolCalls, toolAllowForSession);
    for (const denied of split.denied) {
      const log = makeToolExecutionError(denied.call, denied.message, denied.code);
      toolCalls.push(log.call);
      toolResults.push(log);
      toolError = chooseFirstToolError(toolError, log.result.error);
    }

    if (split.allowed.length > 0) {
      const executed = await executeAllowedToolCalls(requestId, session.sessionId, sessionKey, split.allowed);
      toolCalls.push(...split.allowed.map(normalizeToolCall));
      toolResults.push(...executed.logs);
      toolError = chooseFirstToolError(toolError, executed.toolError);
    }

    if (parsedToolInput.parseError) {
      const parseError = makeToolExecutionError(
        {
          id: `tool-parse-${Date.now()}`,
          name: "tool",
          args: {
            input,
            reason: parsedToolInput.parseError,
          },
          source: "ask",
        },
        parsedToolInput.parseError,
        "invalid_args",
      );
      toolCalls.push(parseError.call);
      toolResults.push(parseError);
      toolError = chooseFirstToolError(toolError, parseError.result.error);
    }

    if (toolResults.length > 0) {
      sessionContextUpdated = true;
    }

    if (parsedToolInput.residualInput.trim()) {
      finalUserContextInput = `${parsedToolInput.residualInput.trim()}\n\n${ASSISTANT_FOLLOWUP_PROMPT}`;
    } else if (toolCalls.length > 0 || parsedToolInput.parseError) {
      finalUserContextInput = ASSISTANT_FOLLOWUP_PROMPT;
    }
  }

  if (manualToolPath) {
    const contextMessages = [...historyContext];
    if (provider === "openai-codex") {
      appendToolCallContextMessages(
        contextMessages,
        {
          roundCalls: toolCalls,
          roundResults: toolResults,
        },
        "",
        "toolUse",
        provider,
      );
    } else {
      for (const log of toolResults) {
        contextMessages.push(makeToolResultContextMessage(log));
      }
    }
    contextMessages.push(makeUserContextMessage(finalUserContextInput));

    const requestContext = makeBaseRequestContext(
      requestId,
      createdAt,
      finalUserContextInput,
      sessionKey,
      session.sessionId,
      contextMessages,
      provider,
      profileId,
      undefined,
      session.memoryEnabled,
    );
    finalResult = (await runPipeline(requestContext)).adapter;
  } else {
    const shouldAutoCall = provider === "openai-codex" && withTools;

    if (shouldAutoCall) {
      const autoTools = listToolsCatalog(toolAllowForSession);
      const contextMessages: Message[] = [...historyContext, makeUserContextMessage(input)];
      const requestContext = makeBaseRequestContext(
        requestId,
        createdAt,
        input,
        sessionKey,
        session.sessionId,
        contextMessages,
        provider,
        profileId,
        autoTools,
        session.memoryEnabled,
      );

      for (let step = 0; step < toolMaxSteps; step += 1) {
        const output = await runPipeline(requestContext);
        finalResult = output.adapter;

        const roundCalls = finalResult.toolCalls?.map(normalizeToolCall) ?? [];
        if (roundCalls.length === 0) {
          break;
        }

        const split = classifyToolCalls(roundCalls, toolAllowForSession);
        const deniedLogs = split.denied.map((entry) =>
          makeToolExecutionError(entry.call, entry.message, entry.code),
        );
        const executed = await executeAllowedToolCalls(requestId, session.sessionId, sessionKey, split.allowed);

        const roundState: ToolLoopState = {
          roundCalls,
          roundResults: [...deniedLogs, ...executed.logs],
        };
        toolCalls.push(...roundCalls);
        toolResults.push(...roundState.roundResults);
        toolError = chooseFirstToolError(toolError, deniedLogs[0]?.result.error);
        toolError = chooseFirstToolError(toolError, executed.toolError);

        appendToolCallContextMessages(
          requestContext.messages,
          roundState,
          finalResult.result,
          finalResult.stopReason,
          provider,
        );

        if (toolResults.length > 0) {
          sessionContextUpdated = true;
        }

        if (step === toolMaxSteps - 1) {
          toolError = chooseFirstToolError(toolError, resolveStepLimitError(roundCalls, toolMaxSteps));
          break;
        }
      }
    } else {
      const contextMessages = [...historyContext, makeUserContextMessage(input)];
      const requestContext = makeBaseRequestContext(
        requestId,
        createdAt,
        input,
        sessionKey,
        session.sessionId,
        contextMessages,
        provider,
        profileId,
        undefined,
        session.memoryEnabled,
      );
      finalResult = (await runPipeline(requestContext)).adapter;
    }
  }

  if (!finalResult) {
    throw new Error("ask pipeline did not return result");
  }

  if (toolResults.length > 0) {
    const toolSummary = buildToolMessages(toolCalls, toolResults);
    await appendSessionMessage(session.sessionId, {
      id: createMessageId("msg-tool-context"),
      role: "system",
      timestamp: nowIso(),
      content: `toolResults:\n${toolSummary}`,
      route: finalResult.route,
      stage: finalResult.stage,
      ...(finalResult.provider ? { provider: finalResult.provider } : {}),
      ...(finalResult.profileId ? { profileId: finalResult.profileId } : {}),
    });
  }

  await appendSessionMessage(session.sessionId, {
    id: createMessageId("msg-user"),
    role: "user",
    timestamp: nowIso(),
    content: manualToolPath ? finalUserContextInput : input,
    route: finalResult.route,
    stage: finalResult.stage,
    ...(finalResult.provider ? { provider: finalResult.provider } : {}),
    ...(finalResult.profileId ? { profileId: finalResult.profileId } : {}),
  });
  await appendSessionMessage(session.sessionId, {
    id: createMessageId("msg-assistant"),
    role: "assistant",
    timestamp: nowIso(),
    content: finalResult.result,
    route: finalResult.route,
    stage: finalResult.stage,
    ...(finalResult.provider ? { provider: finalResult.provider } : {}),
    ...(finalResult.profileId ? { profileId: finalResult.profileId } : {}),
  });

  await recordSessionRoute(sessionKey, finalResult.route, finalResult.profileId, finalResult.provider);

  let memoryUpdated = false;
  if (session.memoryEnabled) {
    const allMessages = await getAllSessionMessages(session.sessionId);
    if (allMessages.length > MEMORY_COMPACT_TRIGGER_MESSAGES) {
      const summary = buildCompactionSummary(allMessages, session.compactedMessageCount);
      if (summary) {
        await appendSessionMemory(session.sessionKey, session.sessionId, summary);
        const cutoff = Math.max(allMessages.length - MEMORY_KEEP_RECENT_MESSAGES, 0);
        await updateSessionRecord(session.sessionKey, { compactedMessageCount: cutoff });
        memoryUpdated = true;
      }
    }
  }

  return {
    success: true,
    requestId,
    createdAt,
    route: finalResult.route,
    stage: finalResult.stage,
    result: finalResult.result,
    ...(finalResult.provider ? { provider: finalResult.provider } : {}),
    ...(finalResult.profileId ? { profileId: finalResult.profileId } : {}),
    sessionKey,
    sessionId: session.sessionId,
    memoryEnabled: session.memoryEnabled,
    memoryUpdated,
    memoryFile: session.memoryEnabled ? getSessionMemoryPath(session.sessionKey) : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    toolError,
    sessionContextUpdated,
  };
}
