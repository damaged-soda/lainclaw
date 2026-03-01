import * as Lark from '@larksuiteoapi/node-sdk';

import {
  type InboundHandler,
  type MessageInboundMessage,
  type IgnoredInboundMessage,
} from '../contracts.js';
import { sendFeishuTextMessage } from './outbound.js';
import type { FeishuGatewayConfig } from './config.js';

interface FeishuWsMessage {
  message?: {
    message_id?: string;
    chat_type?: string;
    chat_id?: string;
    content?: string;
    message_type?: string;
  };
  sender?: {
    sender_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
  };
}

interface FeishuTransportOptions {
  config: FeishuGatewayConfig;
  onInbound: InboundHandler;
}

interface FeishuOutboundMessage {
  requestId: string;
  replyTo: string;
  text: string;
}

const FEISHU_DM_CHAT_TYPES = new Set(['p2p', 'private', 'direct']);
const FEISHU_TEXT_MESSAGE_TYPE = 'text';
const EVENT_ID_TTL_MS = 10 * 60 * 1000;

const EVENT_HISTORY = new Map<string, number>();

function createRequestId() {
  const now = Date.now();
  return `feishu-${now}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, '0')}`;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function parseTextContent(raw: unknown): string {
  if (typeof raw !== 'string') {
    return '';
  }
  const rawTrimmed = raw.trim();
  if (!rawTrimmed) {
    return '';
  }
  try {
    const parsed = JSON.parse(rawTrimmed);
    if (typeof parsed === 'string') {
      return parsed;
    }
    if (parsed && typeof parsed === 'object') {
      const candidate = parsed as Record<string, unknown>;
      if (typeof candidate.text === 'string') {
        return candidate.text;
      }
    }
  } catch {
    return rawTrimmed;
  }
  return rawTrimmed;
}

function normalizeChatType(raw?: string): string {
  return (raw || '').trim().toLowerCase();
}

function inferChatType(chatId?: string): string {
  const normalized = (chatId || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('ou_') || normalized.startsWith('on_')) {
    return 'p2p';
  }
  return 'group';
}

function isReplay(eventId: string, ttlMs: number): boolean {
  const now = Date.now();
  for (const [key, expireAt] of EVENT_HISTORY.entries()) {
    if (expireAt <= now) {
      EVENT_HISTORY.delete(key);
    }
  }
  const existing = EVENT_HISTORY.get(eventId);
  if (existing && existing > now) {
    return true;
  }
  EVENT_HISTORY.set(eventId, now + ttlMs);
  return false;
}

function resolveActorId(rawSender?: FeishuWsMessage['sender']): string {
  return firstNonEmpty(
    rawSender?.sender_id?.open_id,
    rawSender?.sender_id?.user_id,
    rawSender?.sender_id?.union_id,
  ) || 'unknown';
}

function resolveConversationId(actorId: string): string {
  return `dm:${actorId}`;
}

function parseEventId(data: unknown): string | undefined {
  const event = data as Partial<FeishuWsMessage>;
  return firstNonEmpty(event.message?.message_id);
}

function parseFeishuInbound(data: unknown, requestId: string): MessageInboundMessage | IgnoredInboundMessage {
  const event = data as Partial<FeishuWsMessage>;
  const message = event.message;

  const chatId = firstNonEmpty(message?.chat_id);
  const chatType = normalizeChatType(message?.chat_type) || inferChatType(chatId);
  const messageType = firstNonEmpty(message?.message_type);
  const actorId = resolveActorId(event.sender);
  const conversationId = resolveConversationId(actorId);
  const replyTo = actorId;
  const text = parseTextContent(message?.content);

  if (!chatType) {
    return {
      kind: 'ignored',
      channel: 'feishu',
      requestId,
      reason: 'missing-chat-type',
      actorId,
      conversationId,
      replyTo,
      text,
    };
  }

  if (!FEISHU_DM_CHAT_TYPES.has(chatType)) {
    return {
      kind: 'ignored',
      channel: 'feishu',
      requestId,
      reason: 'non-direct-chat',
      actorId,
      conversationId,
      replyTo,
      text,
    };
  }

  if (messageType && messageType !== FEISHU_TEXT_MESSAGE_TYPE) {
    return {
      kind: 'ignored',
      channel: 'feishu',
      requestId,
      reason: 'non-text-message',
      actorId,
      conversationId,
      replyTo,
      text,
    };
  }

  if (actorId === 'unknown' || !text) {
    return {
      kind: 'ignored',
      channel: 'feishu',
      requestId,
      reason: 'missing-open-id-or-content',
      actorId,
      conversationId,
      replyTo,
      text,
    };
  }

  return {
    kind: 'message',
    channel: 'feishu',
    requestId,
    text,
    actorId,
    conversationId,
    replyTo,
  };
}

async function executeOutboundMessage(config: FeishuGatewayConfig, outbound: FeishuOutboundMessage): Promise<void> {
  await sendFeishuTextMessage(config, {
    openId: outbound.replyTo,
    text: outbound.text,
  });
}

export async function runFeishuTransport(options: FeishuTransportOptions): Promise<void> {
  const { config, onInbound } = options;

  if (!config.appId || !config.appSecret) {
    throw new Error('Missing FEISHU_APP_ID or FEISHU_APP_SECRET for websocket mode');
  }

  const eventDispatcher = new Lark.EventDispatcher({});
  eventDispatcher.register({
    'im.message.receive_v1': async (data) => {
      const messageEventId = parseEventId(data);
      const requestId = messageEventId || createRequestId();
      const inbound = parseFeishuInbound(data, requestId);
      if (inbound.kind !== 'message') {
        return;
      }

      const eventId = messageEventId || inbound.requestId;
      if (isReplay(eventId, EVENT_ID_TTL_MS)) {
        return;
      }

      try {
        const outbound = await onInbound(inbound);
        if (!outbound) {
          return;
        }
        await executeOutboundMessage(config, outbound);
      } catch (error) {
        console.error(`[feishu] ${requestId} inbound handler failed: ${String(error instanceof Error ? error.message : error)}`);
      }
    },
  });

  const wsClient = new Lark.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    loggerLevel: Lark.LoggerLevel.info,
  });

  wsClient.start({ eventDispatcher });
  console.log('[feishu] websocket connection started');

  await new Promise<void>((resolve) => {
    const shutdown = (signal: string) => {
      console.log(`[feishu] ${signal} received, shutting down`);
      resolve();
    };
    const onSigInt = () => {
      shutdown('SIGINT');
      process.off('SIGINT', onSigInt);
      process.off('SIGTERM', onSigTerm);
    };
    const onSigTerm = () => {
      shutdown('SIGTERM');
      process.off('SIGINT', onSigInt);
      process.off('SIGTERM', onSigTerm);
    };
    process.once('SIGINT', onSigInt);
    process.once('SIGTERM', onSigTerm);
  });
}
