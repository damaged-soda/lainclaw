import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runAgent } from "../../gateway/gateway.js";
import { resolveAuthDirectory } from "../../auth/configStore.js";
import {
  writeAgentAuditRecord,
} from "../../shared/agentAudit.js";

export interface LocalGatewayOverrides {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  memory?: boolean;
  toolAllow?: string[];
}

interface LocalMessage {
  input?: string;
  sessionKey?: string;
  accountId?: string;
  requestId?: string;
}

interface LocalRunboxRecord {
  channel: "local";
  recordedAt: string;
  requestId: string;
  requestSource: string;
  sessionKey: string;
  input: string;
  output: {
    success: boolean;
    route: string;
    stage: string;
    result: string;
    provider?: string;
    profileId?: string;
    memoryEnabled?: boolean;
    memoryUpdated?: boolean;
    toolCalls?: unknown;
    toolResults?: unknown;
    toolError?: unknown;
    sessionContextUpdated?: boolean;
  };
}

interface LocalErrorRecord {
  channel: "local";
  recordedAt: string;
  requestId: string;
  requestSource: string;
  sessionKey: string;
  input: string;
  error: string;
}

const LOCAL_INBOX_FILE = "local-gateway-inbox.jsonl";
const LOCAL_OUTBOX_FILE = "local-gateway-outbox.jsonl";
const LOCAL_POLL_MS_DEFAULT = 1000;

function parseIntegerMs(raw: string | undefined): number {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return LOCAL_POLL_MS_DEFAULT;
  }
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value) || value <= 0) {
    return LOCAL_POLL_MS_DEFAULT;
  }
  return value;
}

function defaultSessionKey(): string {
  return process.env.LAINCLAW_LOCAL_SESSION_KEY?.trim() || "local:main";
}

function resolveLocalGatewayDir(home = os.homedir()): string {
  return path.join(resolveAuthDirectory(home), "local-gateway");
}

function resolveInboxPath(): string {
  return process.env.LAINCLAW_LOCAL_INBOX_PATH?.trim()
    || path.join(resolveLocalGatewayDir(), LOCAL_INBOX_FILE);
}

function resolveOutboxPath(): string {
  return process.env.LAINCLAW_LOCAL_OUTBOX_PATH?.trim()
    || path.join(resolveLocalGatewayDir(), LOCAL_OUTBOX_FILE);
}

function resolvePollMs(): number {
  return parseIntegerMs(process.env.LAINCLAW_LOCAL_POLL_MS);
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveSessionKey(payload: LocalMessage): string {
  if (payload.sessionKey?.trim()) {
    return payload.sessionKey.trim();
  }

  if (payload.accountId?.trim()) {
    return `local:${payload.accountId.trim()}`;
  }

  return defaultSessionKey();
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

  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    try {
      const parsed = JSON.parse(normalized);
      if (!parsed || typeof parsed !== "object") {
        return undefined;
      }
      const message = parsed as Record<string, unknown>;
      const rawInput =
        typeof message.input === "string"
          ? message.input
          : typeof message.text === "string"
            ? message.text
            : undefined;

      const input = normalizeInput(rawInput);
      if (!input) {
        return undefined;
      }

      return {
        input,
        sessionKey: typeof message.sessionKey === "string" ? message.sessionKey : undefined,
        accountId: typeof message.accountId === "string" ? message.accountId : undefined,
        requestId: typeof message.requestId === "string" ? message.requestId : undefined,
      };
    } catch {
      return undefined;
    }
  }

  return {
    input: normalized,
  };
}

async function ensureDirectory(targetPath: string): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true, mode: 0o700 });
}

async function appendLine(filePath: string, payload: string): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  await fs.appendFile(filePath, `${payload}\n`, { encoding: "utf-8", mode: 0o600 });
}

function writeRunboxRecordSafe(record: LocalRunboxRecord): string {
  return JSON.stringify(record);
}

function writeErrorRecordSafe(record: LocalErrorRecord): string {
  return JSON.stringify(record);
}

function buildRunboxRecord(
  response: Awaited<ReturnType<typeof runAgent>>,
  input: string,
  requestSource: string,
  sessionKey: string,
): LocalRunboxRecord {
  return {
    channel: "local",
    recordedAt: nowIso(),
    requestId: response.requestId,
    requestSource,
    sessionKey,
    input,
    output: {
      success: response.success,
      route: response.route,
      stage: response.stage,
      result: response.result,
      ...(response.provider ? { provider: response.provider } : {}),
      ...(response.profileId ? { profileId: response.profileId } : {}),
      ...(typeof response.memoryEnabled === "boolean" ? { memoryEnabled: response.memoryEnabled } : {}),
      ...(typeof response.memoryUpdated === "boolean" ? { memoryUpdated: response.memoryUpdated } : {}),
      ...(response.toolCalls ? { toolCalls: response.toolCalls } : {}),
      ...(response.toolResults ? { toolResults: response.toolResults } : {}),
      ...(response.toolError ? { toolError: response.toolError } : {}),
      ...(response.sessionContextUpdated ? { sessionContextUpdated: response.sessionContextUpdated } : {}),
    },
  };
}

function buildErrorRecord(
  requestId: string,
  input: string,
  requestSource: string,
  sessionKey: string,
  error: string,
): LocalErrorRecord {
  return {
    channel: "local",
    recordedAt: nowIso(),
    requestId,
    requestSource,
    sessionKey,
    input,
    error,
  };
}

async function readRawInbox(inboxPath: string): Promise<string> {
  try {
    return await fs.readFile(inboxPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export async function runLocalGatewayServer(
  overrides: Partial<LocalGatewayOverrides> = {},
  context: {
    debug?: boolean;
  } = {},
): Promise<void> {
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
    console.log("[local] shutdown requested");
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const opts = {
    provider: overrides.provider,
    profileId: overrides.profileId,
    withTools: overrides.withTools,
    memory: overrides.memory,
    toolAllow: overrides.toolAllow,
  };

  while (running) {
    const raw = await readRawInbox(inboxPath);

    if (raw.length < lastOffset) {
      lastOffset = 0;
    }

  if (raw.length > lastOffset) {
      const appendedText = raw.slice(lastOffset);
      const lines = appendedText.split("\n");
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

        const sessionKey = resolveSessionKey(payload);
        const requestSource = payload.requestId || `seq-${requestSeq++}`;

        try {
          const result = await runAgent(input, {
            ...(typeof opts.provider === "string" && opts.provider.length > 0 ? { provider: opts.provider } : {}),
            ...(typeof opts.profileId === "string" && opts.profileId.length > 0 ? { profileId: opts.profileId } : {}),
            ...(typeof opts.withTools === "boolean" ? { withTools: opts.withTools } : {}),
            ...(Array.isArray(opts.toolAllow) ? { toolAllow: opts.toolAllow } : {}),
            ...(typeof opts.memory === "boolean" ? { memory: opts.memory } : {}),
            ...(typeof sessionKey === "string" && sessionKey.trim() ? { sessionKey } : {}),
            channel: "local",
          });

          const record = buildRunboxRecord(result, input, requestSource, sessionKey);
          await writeAgentAuditRecord({
            channel: "local",
            requestId: result.requestId,
            requestSource,
            sessionKey,
            input,
            emitToStdout: context.debug,
            auditStage: "runAgent.local.success",
            result,
            metadata: {
              channel: "local",
              requestSource,
              auditMode: "stream",
            },
          });
          await appendLine(outboxPath, writeRunboxRecordSafe(record));
          console.log(`[local] ${requestSource} route=${result.route} stage=${result.stage}`);
          continue;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const requestId = `${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
            await writeAgentAuditRecord({
            channel: "local",
            requestId,
            requestSource,
            sessionKey,
            input,
            emitToStdout: context.debug,
            auditStage: "runAgent.local.error",
            error: message,
            metadata: {
              channel: "local",
              requestSource,
              context: "local-gateway",
            },
          }).catch((writeError) => {
            console.warn(`[local] ${requestId} agent audit error-record failed: ${String(writeError)}`);
          });
          const record = buildErrorRecord(requestId, input, requestSource, sessionKey, message);
          await appendLine(outboxPath, writeErrorRecordSafe(record));
          console.log(`[local] ${requestSource} failed: ${message}`);
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
