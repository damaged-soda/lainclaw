import { GatewayResult, RequestContext, ValidationError, PipelineResult, SessionHistoryMessage } from '../shared/types.js';
import { runPipeline } from '../pipeline/pipeline.js';
import {
  appendSessionMessage,
  getOrCreateSession,
  getRecentSessionMessages,
  recordSessionRoute,
} from '../sessions/sessionStore.js';

const DEFAULT_SESSION_KEY = 'main';
const DEFAULT_CONTEXT_MESSAGE_LIMIT = 12;

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

export async function runAsk(
  rawInput: string,
  opts: { provider?: string; profileId?: string; sessionKey?: string; newSession?: boolean } = {},
): Promise<GatewayResult> {
  if (!rawInput || !rawInput.trim()) {
    throw new ValidationError('ask command requires non-empty input', 'ASK_INPUT_REQUIRED');
  }

  const input = rawInput.trim();
  const sessionKey = resolveSessionKey(opts.sessionKey);
  const provider = opts.provider?.trim();
  const profileId = opts.profileId?.trim();
  const session = await getOrCreateSession({
    sessionKey,
    provider,
    profileId,
    forceNew: !!opts.newSession,
  });

  const priorMessages = trimContextMessages(await getRecentSessionMessages(session.sessionId));

  const requestId = createRequestId();
  const createdAt = nowIso();

  const userMessage: SessionHistoryMessage = {
    id: createMessageId('msg-user'),
    role: 'user',
    timestamp: createdAt,
    content: input,
  };

  const context: RequestContext = {
    requestId,
    createdAt,
    input,
    sessionKey,
    sessionId: session.sessionId,
    messages: [...priorMessages, userMessage],
    ...(provider ? { provider } : {}),
    ...(profileId ? { profileId } : {}),
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
  };
}
