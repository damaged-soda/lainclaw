import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  type InboundHandler,
  type InboundMessage,
  type LocalOutboxErrorAction,
  type LocalOutboxSuccessAction,
  type OutboundAction,
} from '../contracts.js';

const LOCAL_INBOX_FILE = 'local-gateway-inbox.jsonl';
const LOCAL_OUTBOX_FILE = 'local-gateway-outbox.jsonl';
const LOCAL_POLL_MS_DEFAULT = 1000;

// 本地传输层只做事件监听与输出落盘，不承担模型调用/策略判断。
function resolveLocalGatewayDirectory(home = os.homedir()): string {
  return path.join(home, '.lainclaw', 'local-gateway');
}

interface LocalMessage {
  input?: string;
  sessionKey?: string;
  accountId?: string;
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

function defaultSessionKey(): string {
  return process.env.LAINCLAW_LOCAL_SESSION_KEY?.trim() || 'local:main';
}

function resolveLocalSessionKey(payload: {
  sessionKey?: string;
  accountId?: string;
}): string {
  const explicit = payload.sessionKey?.trim();
  if (explicit) {
    return explicit;
  }
  const accountId = payload.accountId?.trim();
  if (accountId) {
    return `local:${accountId}`;
  }
  return defaultSessionKey();
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
      const rawInput =
        typeof parsed.input === 'string'
          ? parsed.input
          : typeof parsed.text === 'string'
            ? parsed.text
            : undefined;
      const input = normalizeInput(rawInput);
      if (!input) {
        return undefined;
      }
      return {
        input,
        sessionKey: typeof parsed.sessionKey === 'string' ? parsed.sessionKey : undefined,
        accountId: typeof parsed.accountId === 'string' ? parsed.accountId : undefined,
        requestId: typeof parsed.requestId === 'string' ? parsed.requestId : undefined,
      };
    } catch {
      return undefined;
    }
  }

  const input = normalizeInput(normalized);
  if (!input) {
    return undefined;
  }

  return {
    input,
  };
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
  requestSource: string;
  sessionKey: string;
  input: string;
  output: string;
}): string {
  return JSON.stringify({
    channel: 'local',
    recordedAt: nowIso(),
    requestId: record.requestId,
    requestSource: record.requestSource,
    sessionKey: record.sessionKey,
    input: record.input,
    output: record.output,
  });
}

function buildErrorRecord(record: {
  requestId: string;
  requestSource: string;
  sessionKey: string;
  input: string;
  error: string;
}): string {
  return JSON.stringify({
    channel: 'local',
    recordedAt: nowIso(),
    requestId: record.requestId,
    requestSource: record.requestSource,
    sessionKey: record.sessionKey,
    input: record.input,
    error: record.error,
  });
}

async function executeOutboundActions(actions: readonly OutboundAction[], outboxPath: string): Promise<void> {
  for (const action of actions) {
    if (action.channel !== 'local') {
      continue;
    }

    if (action.kind === 'local.outbox.success') {
      const payload: LocalOutboxSuccessAction = action;
      await appendLine(outboxPath, buildRunboxRecord({
        requestId: payload.requestId,
        requestSource: payload.requestSource,
        sessionKey: payload.sessionKey,
        input: payload.input,
        output: payload.output,
      }));
      continue;
    }

    if (action.kind === 'local.outbox.error') {
      const payload: LocalOutboxErrorAction = action;
      await appendLine(outboxPath, buildErrorRecord({
        requestId: payload.requestId,
        requestSource: payload.requestSource,
        sessionKey: payload.sessionKey,
        input: payload.input,
        error: payload.error,
      }));
      continue;
    }
  }
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

        const input = normalizeInput(payload.input);
        if (!input) {
          continue;
        }

        const requestId = payload.requestId || `seq-${requestSeq++}`;
        const inbound: InboundMessage = {
          kind: 'message',
          channel: 'local',
          requestId,
          requestSource: requestId,
          accountId: payload.accountId?.trim() || undefined,
          sessionHint: payload.sessionKey,
          input,
        };

        const actions = await inboundHandler(inbound).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[local] ${requestId} failed: ${message}`);
          const record: LocalOutboxErrorAction = {
            kind: 'local.outbox.error',
            channel: 'local',
            requestId,
            requestSource: requestId,
            sessionKey: resolveLocalSessionKey(inbound),
            input,
            error: message,
          };
          return [record];
        });

        await executeOutboundActions(actions, outboxPath);
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
