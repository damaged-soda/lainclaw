import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  type InboundHandler,
  type MessageInboundMessage,
  type IgnoredInboundMessage,
  type OutboundMessage,
} from '../contracts.js';

const LOCAL_INBOX_FILE = 'local-gateway-inbox.jsonl';
const LOCAL_OUTBOX_FILE = 'local-gateway-outbox.jsonl';
const LOCAL_POLL_MS_DEFAULT = 1000;

// 本地传输层只做事件监听与输出落盘，不承担模型调用/策略判断。
function resolveLocalGatewayDirectory(home = os.homedir()): string {
  return path.join(home, '.lainclaw', 'local-gateway');
}

interface LocalMessage {
  text?: string;
  input?: string;
  actorId?: string;
  conversationId?: string;
  accountId?: string;
  sessionHint?: string;
  sessionKey?: string;
  requestId?: string;
}

function parseIntegerMs(raw: string | undefined): number {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return LOCAL_POLL_MS_DEFAULT;
  }
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value) || value <= 0) {
    return LOCAL_POLL_MS_DEFAULT;
  }
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeInput(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

function parseMessageLine(line: string): LocalMessage | undefined {
  const normalized = line.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.startsWith('{') || normalized.startsWith('[')) {
    try {
      const parsed = JSON.parse(normalized) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') {
        return undefined;
      }
      const rawText =
        typeof parsed.text === 'string'
          ? parsed.text
          : typeof parsed.input === 'string'
            ? parsed.input
            : undefined;
      const text = normalizeInput(rawText);
      if (!text) {
        return undefined;
      }
      return {
        text,
        actorId: typeof parsed.actorId === 'string' ? parsed.actorId : undefined,
        accountId: typeof parsed.accountId === 'string' ? parsed.accountId : undefined,
        conversationId:
          typeof parsed.conversationId === 'string'
            ? parsed.conversationId
            : typeof parsed.sessionHint === 'string'
              ? parsed.sessionHint
              : typeof parsed.sessionKey === 'string'
                ? parsed.sessionKey
                : undefined,
        requestId: typeof parsed.requestId === 'string' ? parsed.requestId : undefined,
      };
    } catch {
      return undefined;
    }
  }

  const text = normalizeInput(normalized);
  if (!text) {
    return undefined;
  }

  return {
    text,
  };
}

function normalizeActorId(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return 'local';
  }
  return trimmed;
}

function normalizeConversationId(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return 'local:main';
  }
  return trimmed;
}

function resolveLocalSessionKey(payload: {
  actorId: string;
  conversationId: string;
}): string {
  return `${payload.actorId.trim()}:${payload.conversationId.trim()}`;
}

function resolveInboxPath(): string {
  return process.env.LAINCLAW_LOCAL_INBOX_PATH?.trim()
    || path.join(resolveLocalGatewayDirectory(), LOCAL_INBOX_FILE);
}

function resolveOutboxPath(): string {
  return process.env.LAINCLAW_LOCAL_OUTBOX_PATH?.trim()
    || path.join(resolveLocalGatewayDirectory(), LOCAL_OUTBOX_FILE);
}

function resolvePollMs(): number {
  return parseIntegerMs(process.env.LAINCLAW_LOCAL_POLL_MS);
}

async function ensureDirectory(targetPath: string): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true, mode: 0o700 });
}

async function readRawInbox(inboxPath: string): Promise<string> {
  try {
    return await fs.readFile(inboxPath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

function appendLine(filePath: string, payload: string): Promise<void> {
  return ensureDirectory(path.dirname(filePath)).then(() => fs.appendFile(filePath, `${payload}\n`, { encoding: 'utf-8', mode: 0o600 }));
}

function buildRunboxRecord(record: {
  requestId: string;
  sessionKey: string;
  input: string;
  output: string;
}): string {
  return JSON.stringify({
    channel: 'local',
    recordedAt: nowIso(),
    requestId: record.requestId,
    sessionKey: record.sessionKey,
    input: record.input,
    output: record.output,
  });
}

function buildErrorRecord(record: {
  requestId: string;
  sessionKey: string;
  input: string;
  error: string;
}): string {
  return JSON.stringify({
    channel: 'local',
    recordedAt: nowIso(),
    requestId: record.requestId,
    sessionKey: record.sessionKey,
    input: record.input,
    error: record.error,
  });
}

async function executeOutboundMessage(
  outbound: OutboundMessage,
  outboxPath: string,
  sessionKey: string,
  input: string,
): Promise<void> {
  await appendLine(
    outboxPath,
    buildRunboxRecord({
      requestId: outbound.requestId,
      sessionKey,
      input,
      output: outbound.text,
    }),
  );
}

export async function runLocalTransport(inboundHandler: InboundHandler): Promise<void> {
  const inboxPath = resolveInboxPath();
  const outboxPath = resolveOutboxPath();
  const pollMs = resolvePollMs();

  console.log(`[local] local inbound path: ${inboxPath}`);
  console.log(`[local] local outbox path: ${outboxPath}`);
  console.log(`[local] local gateway started, pollMs=${pollMs}`);

  let lastOffset = 0;
  let running = true;
  let requestSeq = 1;

  const shutdown = () => {
    if (!running) {
      return;
    }
    running = false;
    console.log('[local] shutdown requested');
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (running) {
    const raw = await readRawInbox(inboxPath);

    if (raw.length < lastOffset) {
      lastOffset = 0;
    }

    if (raw.length > lastOffset) {
      const appendedText = raw.slice(lastOffset);
      const lines = appendedText.split('\n');
      lastOffset = raw.length;

      for (const rawLine of lines) {
        const payload = parseMessageLine(rawLine);
        if (!payload) {
          continue;
        }

        const text = normalizeInput(payload.text);
        if (!text) {
          continue;
        }

        const actorId = normalizeActorId(payload.actorId || payload.accountId);
        const conversationId = normalizeConversationId(payload.conversationId);
        const requestId = payload.requestId || `seq-${requestSeq++}`;
        const replyTo = conversationId || requestId;
        const inbound: MessageInboundMessage = {
          kind: 'message',
          integration: 'local',
          requestId,
          text,
          actorId,
          conversationId,
          replyTo,
        };

        const sessionKey = resolveLocalSessionKey({
          actorId,
          conversationId,
        });

        try {
          const outbound = await inboundHandler(inbound);
          if (!outbound) {
            continue;
          }
          await executeOutboundMessage(outbound, outboxPath, sessionKey, text);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[local] ${requestId} failed: ${message}`);
          await appendLine(
            outboxPath,
            buildErrorRecord({
              requestId,
              sessionKey,
              input: text,
              error: message,
            }),
          );
          continue;
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  const outboxExists = await fs.access(outboxPath).then(() => true).catch(() => false);
  if (outboxExists) {
    const outboxStat = await fs.stat(outboxPath).catch(() => null);
    const size = outboxStat?.size ?? 0;
    console.log(`[local] shutdown complete, outbox=${outboxPath} bytes=${size}`);
  } else {
    console.log(`[local] shutdown complete, outbox=${outboxPath}`);
  }
}

export function resolveLocalGatewayDir(home = os.homedir()): string {
  return resolveLocalGatewayDirectory(home);
}

export function resolveLocalGatewayPathsForTests(): {
  homeDir: string;
  inboxPath: string;
  outboxPath: string;
} {
  const homeDir = resolveLocalGatewayDir();
  return {
    homeDir,
    inboxPath: resolveInboxPath(),
    outboxPath: resolveOutboxPath(),
  };
}
