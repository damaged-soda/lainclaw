import { ToolContext, ToolSpec } from "../types.js";
import {
  drainFinishedProcessOutput,
  drainProcessOutput,
  getFinishedProcessSession,
  getRunningProcessSession,
  listProcessSessions,
  removeFinishedProcessSession,
  waitForProcessUpdate,
} from "../processRegistry.js";

function normalizeTimeoutMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.min(Math.floor(value), 120_000);
  }
  return 0;
}

function sliceLogLines(
  text: string,
  offset?: number,
  limit?: number,
): { slice: string; totalLines: number } {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const start =
    typeof offset === "number" && Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
  const end =
    typeof limit === "number" && Number.isFinite(limit) && limit >= 0 ? start + Math.floor(limit) : undefined;
  return {
    slice: lines.slice(start, end).join("\n"),
    totalLines: lines.length,
  };
}

function isSameScope(context: ToolContext, sessionKey: string): boolean {
  return (context.sessionKey || context.sessionId || "default") === sessionKey;
}

export const processTool: ToolSpec = {
  name: "process",
  description: "管理 exec 启动的后台进程，会话级查看、轮询、写入和终止。",
  inputSchema: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        description: "支持 list、poll、log、write、kill。",
      },
      sessionId: {
        type: "string",
        description: "目标会话 ID；list 以外的动作必填。",
      },
      data: {
        type: "string",
        description: "write 动作写入到 stdin 的内容。",
      },
      eof: {
        type: "boolean",
        description: "write 后是否关闭 stdin。",
      },
      offset: {
        type: "number",
        description: "log 的起始行号，0-based。",
      },
      limit: {
        type: "number",
        description: "log 的返回行数。",
      },
      timeout: {
        type: "number",
        description: "poll 最多等待多少毫秒再返回。",
      },
    },
  },
  handler: async (context: ToolContext, args: Record<string, unknown>) => {
    if (typeof args.action !== "string" || !args.action.trim()) {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "process",
          message: "action is required",
        },
      };
    }

    const action = args.action.trim();
    const currentSessionKey = context.sessionKey || context.sessionId || "default";

    if (action === "list") {
      const sessions = listProcessSessions(currentSessionKey);
      return {
        ok: true,
        content:
          sessions.length > 0
            ? sessions
                .map((session) => `${session.id} ${session.status} ${session.command}`)
                .join("\n")
            : "No running or recent process sessions.",
        data: { sessions },
      };
    }

    if (typeof args.sessionId !== "string" || !args.sessionId.trim()) {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "process",
          message: "sessionId is required for this action",
        },
      };
    }

    const running = getRunningProcessSession(args.sessionId);
    if (running && !isSameScope(context, running.sessionKey)) {
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "process",
          message: `session ${args.sessionId} is not visible in this session scope`,
        },
      };
    }
    const finished = getFinishedProcessSession(args.sessionId);
    if (finished && !isSameScope(context, finished.sessionKey)) {
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "process",
          message: `session ${args.sessionId} is not visible in this session scope`,
        },
      };
    }

    if (action === "poll") {
      if (running) {
        await waitForProcessUpdate(running, normalizeTimeoutMs(args.timeout));
        const drained = drainProcessOutput(running);
        return {
          ok: true,
          content:
            drained.stdout || drained.stderr
              ? [drained.stdout, drained.stderr].filter(Boolean).join("\n")
              : `Session ${running.id} is still ${running.status}.`,
          data: {
            sessionId: running.id,
            status: running.status,
            stdout: drained.stdout,
            stderr: drained.stderr,
            exitCode: running.exitCode ?? null,
            exitSignal: running.exitSignal ?? null,
          },
        };
      }
      if (finished) {
        const drained = drainFinishedProcessOutput(finished);
        return {
          ok: true,
          content:
            drained.stdout || drained.stderr
              ? [drained.stdout, drained.stderr].filter(Boolean).join("\n")
              : `Session ${finished.id} already ${finished.status}.`,
          data: {
            sessionId: finished.id,
            status: finished.status,
            stdout: drained.stdout,
            stderr: drained.stderr,
            exitCode: finished.exitCode ?? null,
            exitSignal: finished.exitSignal ?? null,
          },
        };
      }
    }

    if (action === "log") {
      const sourceText = running?.aggregatedOutput ?? finished?.aggregatedOutput;
      if (typeof sourceText !== "string") {
        return {
          ok: false,
          error: {
            code: "execution_error",
            tool: "process",
            message: `session not found: ${args.sessionId}`,
          },
        };
      }

      const view = sliceLogLines(
        sourceText,
        typeof args.offset === "number" ? args.offset : undefined,
        typeof args.limit === "number" ? args.limit : undefined,
      );
      return {
        ok: true,
        content: view.slice || "Session has no output.",
        data: {
          sessionId: args.sessionId,
          status: running?.status ?? finished?.status ?? "completed",
          totalLines: view.totalLines,
        },
      };
    }

    if (action === "write") {
      if (!running) {
        return {
          ok: false,
          error: {
            code: "execution_error",
            tool: "process",
            message: `session is not running: ${args.sessionId}`,
          },
        };
      }
      if (typeof args.data !== "string") {
        return {
          ok: false,
          error: {
            code: "invalid_args",
            tool: "process",
            message: "data must be a string for write",
          },
        };
      }
      if (running.child.stdin.destroyed) {
        return {
          ok: false,
          error: {
            code: "execution_error",
            tool: "process",
            message: `stdin is closed for session ${args.sessionId}`,
          },
        };
      }

      await new Promise<void>((resolve, reject) => {
        running.child.stdin.write(args.data, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }).catch((error) => {
        throw error;
      });

      if (args.eof === true) {
        running.child.stdin.end();
      }

      return {
        ok: true,
        content: `Wrote to session ${running.id}.`,
        data: {
          sessionId: running.id,
          eof: args.eof === true,
        },
      };
    }

    if (action === "kill") {
      if (running) {
        running.child.kill("SIGTERM");
        return {
          ok: true,
          content: `Termination signal sent to session ${running.id}.`,
          data: {
            sessionId: running.id,
            status: running.status,
          },
        };
      }
      if (finished) {
        removeFinishedProcessSession(finished.id);
        return {
          ok: true,
          content: `Removed finished session ${finished.id}.`,
          data: {
            sessionId: finished.id,
            status: finished.status,
          },
        };
      }
    }

    return {
      ok: false,
      error: {
        code: "invalid_args",
        tool: "process",
        message: `unsupported action: ${action}`,
      },
    };
  },
};
