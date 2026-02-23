import fs from "node:fs/promises";
import path from "node:path";
import type { GatewayResult, PromptAudit } from "./types.js";
import { resolveAuthDirectory } from "../auth/configStore.js";

const DEFAULT_AUDIT_FILE_NAME = "gateway-ask-audit.jsonl";
const FALLBACK_AUDIT_DIR = ".lainclaw-ask-audit-fallback";

type AskChannel = "local" | "feishu";

interface AskAuditOutput {
  success: boolean;
  route?: string;
  stage?: string;
  result?: string;
  provider?: string;
  profileId?: string;
  memoryEnabled?: boolean;
  memoryUpdated?: boolean;
  toolCalls?: unknown;
  toolResults?: unknown;
  toolError?: unknown;
  sessionContextUpdated?: boolean;
  promptAudit?: PromptAudit;
  error?: string;
}

export interface AskAuditRecord {
  channel: AskChannel;
  recordedAt: string;
  requestId: string;
  requestSource: string;
  sessionKey: string;
  input: string;
  output: AskAuditOutput;
  metadata?: Record<string, unknown>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveDefaultAuditPath(channel: AskChannel): string {
  const basePath = resolveAuthDirectory();
  const filename = `${channel}-${DEFAULT_AUDIT_FILE_NAME}`;
  return path.join(basePath, "gateway-audit", filename);
}

function resolveAuditPath(channel: AskChannel): string {
  const override = process.env.LAINCLAW_PROMPT_AUDIT_PATH;
  if (typeof override === "string" && override.trim()) {
    return override.trim();
  }

  return resolveDefaultAuditPath(channel);
}

function resolveFallbackAuditPath(channel: AskChannel): string {
  return path.join(resolveAuthDirectory(), FALLBACK_AUDIT_DIR, `${channel}-${DEFAULT_AUDIT_FILE_NAME}`);
}

export function resolveAskAuditPath(channel: AskChannel): string {
  return resolveAuditPath(channel);
}

async function ensureDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
}

export async function ensureAskAuditDirectory(channel: AskChannel): Promise<void> {
  const auditPath = resolveAskAuditPath(channel);
  await ensureDirectory(path.dirname(auditPath));
}

async function appendLine(filePath: string, line: string): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  await fs.appendFile(filePath, `${line}\n`, { encoding: "utf-8", mode: 0o600 });
}

function buildAskAuditErrorSummary(error: unknown): string {
  const err = error as NodeJS.ErrnoException;
  return `${err.name ?? "Error"} ${err.code ? `[${err.code}]` : ""} ${err.message ?? String(err)}`;
}

function buildAuditOutput(result: GatewayResult): AskAuditOutput {
  return {
    success: result.success,
    ...(typeof result.route === "string" ? { route: result.route } : {}),
    ...(typeof result.stage === "string" ? { stage: result.stage } : {}),
    ...(typeof result.result === "string" ? { result: result.result } : {}),
    ...(result.provider ? { provider: result.provider } : {}),
    ...(result.profileId ? { profileId: result.profileId } : {}),
    ...(typeof result.memoryEnabled === "boolean" ? { memoryEnabled: result.memoryEnabled } : {}),
    ...(typeof result.memoryUpdated === "boolean" ? { memoryUpdated: result.memoryUpdated } : {}),
    ...(result.toolCalls ? { toolCalls: result.toolCalls } : {}),
    ...(result.toolResults ? { toolResults: result.toolResults } : {}),
    ...(result.toolError ? { toolError: result.toolError } : {}),
    ...(typeof result.sessionContextUpdated === "boolean" ? { sessionContextUpdated: result.sessionContextUpdated } : {}),
    ...(result.promptAudit ? { promptAudit: result.promptAudit } : {}),
  };
}

export async function writeAskAuditRecord(params: {
  channel: AskChannel;
  requestId: string;
  requestSource: string;
  sessionKey: string;
  input: string;
  result?: GatewayResult;
  error?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!params.result && !params.error) {
    return;
  }

  const record: AskAuditRecord = {
    channel: params.channel,
    recordedAt: nowIso(),
    requestId: params.requestId,
    requestSource: params.requestSource,
    sessionKey: params.sessionKey,
    input: params.input,
    output: params.result ? buildAuditOutput(params.result) : { success: false, error: params.error ?? "unknown error" },
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };

  const primaryPath = resolveAuditPath(params.channel);
  const payload = JSON.stringify(record);

  const primaryTarget = [primaryPath];
  if (typeof process.env.LAINCLAW_PROMPT_AUDIT_PATH !== "string" || !process.env.LAINCLAW_PROMPT_AUDIT_PATH.trim()) {
    primaryTarget.push(resolveFallbackAuditPath(params.channel));
  }

  for (const auditPath of primaryTarget) {
    try {
      await appendLine(auditPath, payload);
      return;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT" || err.code === "ENOTDIR") {
        try {
          await ensureDirectory(path.dirname(auditPath));
          await appendLine(auditPath, payload);
          return;
        } catch (retryError) {
          const retryErr = retryError as NodeJS.ErrnoException;
          console.warn(`[ask-audit] write failed (${retryErr.code ?? "unknown"}) for ${auditPath}: ${buildAskAuditErrorSummary(retryError)}`);
        }
      } else {
        console.warn(`[ask-audit] write failed (${err.code ?? "unknown"}) for ${auditPath}: ${buildAskAuditErrorSummary(error)}`);
      }
    }
  }

  console.warn(`[ask-audit] exhausted write targets for channel=${params.channel} request=${params.requestId}`);
}
