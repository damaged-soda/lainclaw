import { executeTool } from "../tools/executor.js";
import type { ToolCall, ToolExecutionLog, ToolErrorCode } from "../tools/types.js";
import type { ToolContext } from "../tools/types.js";
import { isToolAllowed } from "../tools/registry.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_RETRY_ATTEMPTS = 1;
const DEFAULT_RETRY_DELAY_MS = 250;

interface SemaphoreRelease {
  (): void;
}

export interface ToolSandboxOptions {
  allowList?: string[];
  timeoutMs?: number;
  maxConcurrentTools?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  retryableErrorCodes?: ToolErrorCode[];
}

function normalizeRetryErrorCodes(raw: ToolErrorCode[] | undefined): ToolErrorCode[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return ["execution_error", "tool_not_found", "invalid_args"];
  }
  return raw;
}

function normalizeNumber(raw: unknown, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(1, Math.floor(raw));
}

function parseToolErrorCode(code: unknown): ToolErrorCode {
  if (code === "invalid_args" || code === "tool_not_found") {
    return code;
  }
  return "execution_error";
}

function normalizeToolError(
  toolCall: ToolCall,
  errorMessage: string,
  code: ToolErrorCode = "execution_error",
): ToolExecutionLog {
  return {
    call: toolCall,
    result: {
      ok: false,
      error: {
        tool: toolCall.name,
        code,
        message: errorMessage,
      },
      meta: {
        tool: toolCall.name,
        durationMs: 0,
      },
    },
  };
}

async function withTimeout<T>(
  op: () => Promise<T>,
  timeoutMs: number,
  toolName: string,
): Promise<T> {
  if (timeoutMs <= 0) {
    return op();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`tool "${toolName}" timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    op().then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class ToolSandbox {
  private readonly allowList: string[];
  private readonly timeoutMs: number;
  private readonly maxConcurrentTools: number;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;
  private readonly retryableErrorCodes: ToolErrorCode[];
  private active = 0;
  private readonly waitQueue: Array<SemaphoreRelease> = [];

  constructor(raw: ToolSandboxOptions = {}) {
    this.allowList = Array.isArray(raw.allowList)
      ? raw.allowList.map((entry) => entry.trim().toLowerCase()).filter(Boolean)
      : [];
    this.timeoutMs = normalizeNumber(raw.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.maxConcurrentTools = normalizeNumber(raw.maxConcurrentTools, DEFAULT_MAX_CONCURRENT);
    this.retryAttempts = normalizeNumber(raw.retryAttempts, DEFAULT_RETRY_ATTEMPTS);
    this.retryDelayMs = normalizeNumber(raw.retryDelayMs, DEFAULT_RETRY_DELAY_MS);
    this.retryableErrorCodes = normalizeRetryErrorCodes(raw.retryableErrorCodes);
  }

  private acquireSlot(): Promise<SemaphoreRelease> {
    if (this.active < this.maxConcurrentTools) {
      this.active += 1;
      return Promise.resolve(() => this.releaseSlot());
    }
    return new Promise<SemaphoreRelease>((resolve) => {
      this.waitQueue.push(() => {
        this.active += 1;
        resolve(() => this.releaseSlot());
      });
    });
  }

  private releaseSlot(): void {
    if (this.active > 0) {
      this.active -= 1;
    }
    const next = this.waitQueue.shift();
    if (next) {
      next();
    }
  }

  private shouldRetry(errorCode: unknown): boolean {
    const normalized = parseToolErrorCode(errorCode);
    return this.retryableErrorCodes.includes(normalized);
  }

  async execute(call: ToolCall, context: ToolContext): Promise<ToolExecutionLog> {
    if (!isToolAllowed(call.name, this.allowList)) {
      return normalizeToolError(call, `tool not allowed: ${call.name}`, "tool_not_found");
    }

    const release = await this.acquireSlot();
    const started = Date.now();
    try {
      const attempts = Math.max(1, this.retryAttempts);
      let lastLog: ToolExecutionLog | undefined;

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          const log = await withTimeout(() => executeTool(call, context), this.timeoutMs, call.name);
          const finalLog = {
            call: { ...log.call },
            result: {
              ...log.result,
              meta: {
                ...log.result.meta,
                durationMs: Math.max(1, Date.now() - started),
              },
            },
          };
          lastLog = finalLog;

          if (finalLog.result.ok) {
            return finalLog;
          }

          if (attempt < attempts - 1 && finalLog.result.error && this.shouldRetry(finalLog.result.error.code)) {
            await sleep(this.retryDelayMs * Math.pow(2, attempt));
            continue;
          }
          return finalLog;
        } catch (error) {
          const message = error instanceof Error ? error.message : "tool execution failed";
          lastLog = normalizeToolError(call, message, "execution_error");
          if (attempt < attempts - 1) {
            await sleep(this.retryDelayMs * Math.pow(2, attempt));
            continue;
          }
          break;
        }
      }

      return lastLog ?? normalizeToolError(call, "tool execution failed", "execution_error");
    } finally {
      release();
    }
  }
}

export function createDefaultToolSandboxOptions(): ToolSandboxOptions {
  return {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxConcurrentTools: DEFAULT_MAX_CONCURRENT,
    retryAttempts: DEFAULT_RETRY_ATTEMPTS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    retryableErrorCodes: ["execution_error"],
  };
}
