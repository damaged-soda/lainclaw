import { GatewayResult, RequestContext, ValidationError, PipelineResult, SessionHistoryMessage } from '../shared/types.js';
import { runPipeline } from '../pipeline/pipeline.js';
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
} from '../sessions/sessionStore.js';
import type { ToolCall, ToolContext, ToolExecutionLog, ToolError } from '../tools/types.js';
import { invokeToolsForAsk } from '../tools/gateway.js';
import { isToolAllowed } from '../tools/registry.js';

const DEFAULT_SESSION_KEY = 'main';
const DEFAULT_CONTEXT_MESSAGE_LIMIT = 12;
const MEMORY_COMPACT_TRIGGER_MESSAGES = 24;
const MEMORY_KEEP_RECENT_MESSAGES = 12;
const MEMORY_MIN_COMPACT_WINDOW = 6;
const MEMORY_SUMMARY_MESSAGE_LIMIT = 16;
const MEMORY_SUMMARY_LINE_LIMIT = 120;
const TOOL_PARSE_PREFIX = 'tool:';

function createRequestId() {
  const now = Date.now();
  const suffix = Math.floor(Math.random() * 10000).toString(16).padStart(4, '0');
  return `lc-${now}-${suffix}`;
}

function nowIso() {
  return new Date().toISOString();
}

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, '0')}`;
}

function resolveSessionKey(rawSessionKey: string | undefined): string {
  const normalized = rawSessionKey?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_SESSION_KEY;
}

function trimContextMessages(messages: SessionHistoryMessage[]): SessionHistoryMessage[] {
  if (messages.length <= DEFAULT_CONTEXT_MESSAGE_LIMIT) {
    return messages;
  }
  return messages.slice(-DEFAULT_CONTEXT_MESSAGE_LIMIT);
}

function clampMemoryFlag(value: boolean | undefined): boolean | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  return !!value;
}

function truncateText(raw: string, maxLength: number): string {
  const trimmed = raw.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
}

function buildCompactionSummary(
  messages: SessionHistoryMessage[],
  compactedMessageCount: number,
): string {
  const cutoff = Math.max(messages.length - MEMORY_KEEP_RECENT_MESSAGES, 0);
  const compactFrom = Math.max(0, Math.min(compactedMessageCount, cutoff));
  const candidates = messages
    .slice(compactFrom, cutoff)
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-MEMORY_SUMMARY_MESSAGE_LIMIT);

  if (candidates.length < MEMORY_MIN_COMPACT_WINDOW) {
    return '';
  }

  const lines = candidates.map((message) => `${message.role}: ${truncateText(message.content, MEMORY_SUMMARY_LINE_LIMIT)}`);
  return `## Memory Summary\n${lines.map((line) => `- ${line}`).join('\n')}`;
}

function normalizeToolAllow(raw: string[] | undefined): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }
  return raw
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter((entry) => entry.length > 0);
}

function makeToolExecutionError(call: ToolCall, message: string, code: ToolError["code"]): ToolExecutionLog {
  return {
    call: {
      ...call,
      id: call.id || `tool-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, '0')}`,
    },
    result: {
      ok: false,
      content: undefined,
      error: {
        tool: call.name,
        code,
        message,
      },
      meta: {
        tool: call.name,
        durationMs: 0,
      },
    },
  };
}

interface ParsedToolInput {
  toolCalls: ToolCall[];
  residualInput: string;
  parseError?: string;
}

function parseToolCallsFromPrompt(rawInput: string): ParsedToolInput {
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
      residualInput: '',
      parseError: 'tool invocation missing content',
    };
  }

  let command = payload;
  let residual = '';
  const separator = payload.indexOf('\n');
  if (separator >= 0) {
    command = payload.slice(0, separator).trim();
    residual = payload.slice(separator + 1).trim();
  }

  if (!command) {
    return {
      toolCalls: [],
      residualInput: residual,
      parseError: 'tool invocation missing call payload',
    };
  }

  try {
    let calls: unknown[] = [];

    if (command.startsWith('[') || command.startsWith('{')) {
      const parsed = JSON.parse(command);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      if (list.length === 0) {
        return {
          toolCalls: [],
          residualInput: residual,
          parseError: 'tool invocation array is empty',
        };
      }
      calls = list;
    } else {
      const rawName = command.trim();
      const firstSpace = rawName.search(/\s/);
      const name = firstSpace >= 0 ? rawName.slice(0, firstSpace).trim() : rawName;
      const argsText = firstSpace >= 0 ? rawName.slice(firstSpace + 1).trim() : '';

      const args = argsText ? JSON.parse(argsText) : {};
      calls = [
        {
          name,
          args,
        },
      ];
    }

    const toolCalls: ToolCall[] = calls.map((entry, index) => {
        if (!entry || typeof entry !== 'object') {
          throw new Error(`tool invocation #${index + 1} is invalid`);
        }

        const normalized = entry as Partial<ToolCall>;
        const name = typeof normalized.name === 'string' ? normalized.name.trim() : '';
        if (!name) {
          throw new Error(`tool invocation #${index + 1} missing name`);
        }

        return {
          id: typeof normalized.id === 'string' && normalized.id.trim().length > 0
            ? normalized.id.trim()
            : `tool-${Date.now()}-${index + 1}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, '0')}`,
          name,
          args: normalized.args,
          source: 'ask',
        };
      });

    return {
      toolCalls,
      residualInput: residual,
    };
  } catch (error) {
    return {
      toolCalls: [],
      residualInput: residual,
      parseError: error instanceof Error ? error.message : 'invalid tool payload',
    };
  }
}

function buildToolMessages(
  calls: ToolCall[],
  results: ToolExecutionLog[],
): string {
  const normalized = calls.map((call) => {
    const matched = results.find((result) => result.call.id === call.id || result.call.name === call.name);
    if (!matched) {
      return {
        call,
        result: {
          ok: false,
          error: {
            code: 'execution_error',
            tool: call.name,
            message: 'tool result missing',
          },
          meta: {
            tool: call.name,
            durationMs: 0,
          },
        },
      };
    }
    return {
      call: matched.call,
      result: {
        ok: matched.result.ok,
        content: matched.result.content,
        data: matched.result.data,
        error: matched.result.error,
        meta: matched.result.meta,
      },
    };
  });

  return JSON.stringify(normalized, null, 2);
}

export async function runAsk(
  rawInput: string,
  opts: { provider?: string; profileId?: string; sessionKey?: string; newSession?: boolean; memory?: boolean; withTools?: boolean; toolAllow?: string[] } = {},
): Promise<GatewayResult> {
  if (!rawInput || !rawInput.trim()) {
    throw new ValidationError('ask command requires non-empty input', 'ASK_INPUT_REQUIRED');
  }

  const input = rawInput.trim();
  const sessionKey = resolveSessionKey(opts.sessionKey);
  const provider = opts.provider?.trim();
  const profileId = opts.profileId?.trim();
  const memoryEnabled = clampMemoryFlag(opts.memory);
  const withTools = typeof opts.withTools === 'boolean' ? opts.withTools : true;
  const toolAllow = normalizeToolAllow(opts.toolAllow);
  const session = await getOrCreateSession({
    sessionKey,
    provider,
    profileId,
    forceNew: !!opts.newSession,
    ...(typeof memoryEnabled === 'boolean' ? { memory: memoryEnabled } : {}),
  });

  const memorySnippet = session.memoryEnabled ? await loadSessionMemorySnippet(session.sessionKey) : '';
  const priorMessages = trimContextMessages(await getRecentSessionMessages(session.sessionId));
  const userMessage: SessionHistoryMessage = {
    id: createMessageId('msg-user'),
    role: 'user',
    timestamp: nowIso(),
    content: input,
  };

  const contextMessages: SessionHistoryMessage[] = [
    ...priorMessages,
    userMessage,
  ];
  if (memorySnippet) {
    contextMessages.unshift({
      id: createMessageId('msg-memory'),
      role: 'system',
      timestamp: nowIso(),
      content: `[memory]\n${memorySnippet}`,
    });
  }

  const requestId = createRequestId();
  const createdAt = nowIso();
  const parsedTools = withTools ? parseToolCallsFromPrompt(input) : {
    toolCalls: [],
    residualInput: input,
  };

  let toolCalls = parsedTools.toolCalls;
  const toolResults: ToolExecutionLog[] = [];
  let toolError: ToolError | undefined;

  if (toolCalls.length > 0) {
    if (toolAllow.length > 0) {
      const [allowed, denied] = toolCalls.reduce(
        ([include, exclude], call) => {
          if (isToolAllowed(call.name, toolAllow)) {
            include.push(call);
          } else {
            exclude.push(call);
          }
          return [include, exclude];
        },
        [[], []] as [ToolCall[], ToolCall[]],
      );
      toolCalls = allowed;
      denied.forEach((call) => {
        const deniedResult = makeToolExecutionError(call, `tool not allowed: ${call.name}`, 'tool_not_found');
        toolError = deniedResult.result.error;
        toolResults.push(deniedResult);
      });
    }

    if (toolCalls.length > 0) {
      const toolContext: ToolContext = {
        requestId,
        sessionId: session.sessionId,
        sessionKey,
        cwd: process.cwd(),
      };

      if (parsedTools.parseError) {
        const parseError = makeToolExecutionError(
          {
            id: `tool-parse-${Date.now()}`,
            name: 'ask',
            args: {
              raw: parsedTools.residualInput,
              reason: parsedTools.parseError,
            },
          },
          parsedTools.parseError,
          'invalid_args',
        );
        toolError = parseError.result.error;
        toolResults.push(parseError);
      }

      const executionLogs = await invokeToolsForAsk(toolCalls, toolContext);
      executionLogs.forEach((entry) => {
        if (!entry.result.ok && !toolError) {
          toolError = entry.result.error;
        }
      });
      toolResults.push(...executionLogs);

      const toolSummaryContent = buildToolMessages(toolCalls, toolResults);
      contextMessages.push({
        id: createMessageId('msg-tool'),
        role: 'system',
        timestamp: nowIso(),
        content: `[tool_results]\n${toolSummaryContent}`,
      });
    }
  }

  if (parsedTools.parseError && parsedTools.toolCalls.length === 0) {
    const parseError = makeToolExecutionError(
      {
        id: `tool-parse-${Date.now()}`,
        name: 'ask',
        args: {
          raw: parsedTools.residualInput,
          reason: parsedTools.parseError,
        },
      },
      parsedTools.parseError,
      'invalid_args',
    );
    toolError = parseError.result.error;
    toolResults.push(parseError);
  }

  const residualInput = parsedTools.residualInput || input;
  const pipelineInput = withTools && toolCalls.length > 0
    ? `${residualInput}\n\n请基于上述工具结果回答问题。`
    : input;

  const context: RequestContext = {
    requestId,
    createdAt,
    input: pipelineInput,
    sessionKey,
    sessionId: session.sessionId,
    messages: contextMessages,
    ...(provider ? { provider } : {}),
    ...(profileId ? { profileId } : {}),
    memoryEnabled: session.memoryEnabled,
  };

  const pipelineOutput = await runPipeline(context);
  const adapter = pipelineOutput.adapter;
  const result: PipelineResult = {
    requestId: context.requestId,
    createdAt: context.createdAt,
    route: adapter.route,
    stage: adapter.stage,
    result: adapter.result,
    ...(adapter.provider ? { provider: adapter.provider } : {}),
    ...(adapter.profileId ? { profileId: adapter.profileId } : {}),
  };

  const shouldAppendToolContext = withTools && toolCalls.length > 0;
  if (shouldAppendToolContext) {
    const toolResultContent = buildToolMessages(toolCalls, toolResults);
    await appendSessionMessage(session.sessionId, {
      id: createMessageId('msg-tool-context'),
      role: 'system',
      timestamp: nowIso(),
      content: `toolResults:\n${toolResultContent}`,
      route: adapter.route,
      stage: adapter.stage,
      ...(result.provider ? { provider: result.provider } : {}),
      ...(result.profileId ? { profileId: result.profileId } : {}),
    });
  }

  await appendSessionMessage(session.sessionId, {
    ...userMessage,
    route: adapter.route,
    stage: adapter.stage,
    ...(result.provider ? { provider: result.provider } : {}),
    ...(result.profileId ? { profileId: result.profileId } : {}),
  });

  await appendSessionMessage(session.sessionId, {
    id: createMessageId('msg-assistant'),
    role: 'assistant',
    timestamp: nowIso(),
    content: result.result,
    route: adapter.route,
    stage: adapter.stage,
    ...(result.provider ? { provider: result.provider } : {}),
    ...(result.profileId ? { profileId: result.profileId } : {}),
  });

  await recordSessionRoute(sessionKey, adapter.route, result.profileId, result.provider);

  let memoryUpdated = false;
  if (session.memoryEnabled) {
    const allMessages = await getAllSessionMessages(session.sessionId);
    if (allMessages.length > MEMORY_COMPACT_TRIGGER_MESSAGES) {
      const summary = buildCompactionSummary(allMessages, session.compactedMessageCount);
      if (summary) {
        await appendSessionMemory(session.sessionKey, session.sessionId, summary);
        const cutoff = Math.max(allMessages.length - MEMORY_KEEP_RECENT_MESSAGES, 0);
        await updateSessionRecord(session.sessionKey, {
          compactedMessageCount: cutoff,
        });
        memoryUpdated = true;
      }
    }
  }

  return {
    success: true,
    requestId: context.requestId,
    createdAt: context.createdAt,
    route: result.route,
    stage: result.stage,
    result: result.result,
    ...(result.provider ? { provider: result.provider } : {}),
    ...(result.profileId ? { profileId: result.profileId } : {}),
    sessionKey,
    sessionId: session.sessionId,
    memoryEnabled: session.memoryEnabled,
    memoryUpdated,
    memoryFile: session.memoryEnabled ? getSessionMemoryPath(session.sessionKey) : undefined,
    toolCalls,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    toolError,
    sessionContextUpdated: shouldAppendToolContext,
  };
}
