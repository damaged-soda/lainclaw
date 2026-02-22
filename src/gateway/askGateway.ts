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

const DEFAULT_SESSION_KEY = 'main';
const DEFAULT_CONTEXT_MESSAGE_LIMIT = 12;
const MEMORY_COMPACT_TRIGGER_MESSAGES = 24;
const MEMORY_KEEP_RECENT_MESSAGES = 12;
const MEMORY_MIN_COMPACT_WINDOW = 6;
const MEMORY_SUMMARY_MESSAGE_LIMIT = 16;
const MEMORY_SUMMARY_LINE_LIMIT = 120;

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

export async function runAsk(
  rawInput: string,
  opts: { provider?: string; profileId?: string; sessionKey?: string; newSession?: boolean; memory?: boolean } = {},
): Promise<GatewayResult> {
  if (!rawInput || !rawInput.trim()) {
    throw new ValidationError('ask command requires non-empty input', 'ASK_INPUT_REQUIRED');
  }

  const input = rawInput.trim();
  const sessionKey = resolveSessionKey(opts.sessionKey);
  const provider = opts.provider?.trim();
  const profileId = opts.profileId?.trim();
  const memoryEnabled = clampMemoryFlag(opts.memory);
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

  const context: RequestContext = {
    requestId,
    createdAt,
    input,
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
  };
}
