import { createHash } from "node:crypto";
import type { GatewayResult, PromptAudit } from "./types.js";

type AgentChannel = "local" | "feishu";

interface AgentAuditOutput {
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
  errorKind?: string;
  timeoutMs?: number;
}

interface AgentAuditMetadata {
  inputLength: number;
  inputPreview: string;
  inputTruncated: boolean;
  inputChecksum: string;
  errorKind?: string;
  timeoutMs?: number;
  auditStage?: string;
}

export interface AgentAuditRecord {
  channel: AgentChannel;
  recordedAt: string;
  requestId: string;
  requestSource: string;
  sessionKey: string;
  input: string;
  output: AgentAuditOutput;
  metadata?: AgentAuditMetadata | Record<string, unknown>;
}

const INPUT_PREVIEW_LIMIT = 1024;

function buildAuditOutput(result: GatewayResult): AgentAuditOutput {
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

function nowIso(): string {
  return new Date().toISOString();
}

function parseAuditErrorMetadata(error: string | undefined): {
  errorKind?: string;
  timeoutMs?: number;
} {
  if (!error) {
    return {};
  }
  const message = String(error).toLowerCase();
  const errorKind = message.includes("timeout") ? "timeout" : "runtime_error";
  const timeoutMatch = message.match(/(\d+)\s*ms/i);
  if (!timeoutMatch) {
    return { errorKind };
  }
  const timeoutMs = Number.parseInt(timeoutMatch[1] ?? "", 10);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? { errorKind, timeoutMs } : { errorKind };
}

function makeInputPreview(input: string): string {
  if (input.length <= INPUT_PREVIEW_LIMIT) {
    return input;
  }
  return input.slice(0, INPUT_PREVIEW_LIMIT);
}

function checksumInput(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

function emitAuditRecord(record: AgentAuditRecord): void {
  console.log(JSON.stringify(record));
}

export async function writeAgentAuditRecord(params: {
  channel: AgentChannel;
  requestId: string;
  requestSource: string;
  sessionKey: string;
  input: string;
  result?: GatewayResult;
  error?: string;
  metadata?: Record<string, unknown>;
  emitToStdout?: boolean;
  auditStage?: string;
}): Promise<void> {
  if (!params.result && !params.error) {
    return;
  }

  const inputLength = params.input.length;
  const { errorKind, timeoutMs } = parseAuditErrorMetadata(params.error);
  const inputPreview = makeInputPreview(params.input);

  const metadata: AgentAuditMetadata = {
    inputLength,
    inputPreview,
    inputTruncated: inputLength > INPUT_PREVIEW_LIMIT,
    inputChecksum: checksumInput(params.input),
    ...(params.auditStage ? { auditStage: params.auditStage } : {}),
    ...(errorKind ? { errorKind } : {}),
    ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
    ...(params.metadata ?? {}),
  };

  const record: AgentAuditRecord = {
    channel: params.channel,
    recordedAt: nowIso(),
    requestId: params.requestId,
    requestSource: params.requestSource,
    sessionKey: params.sessionKey,
    input: params.input,
    output: params.result
      ? {
          ...buildAuditOutput(params.result),
          ...(params.error ? { errorKind, timeoutMs } : {}),
        }
      : {
          success: false,
          error: params.error ?? "unknown error",
          ...(errorKind ? { errorKind } : {}),
          ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
        },
    metadata,
  };
  if (params.emitToStdout) {
    emitAuditRecord(record);
  }
}
