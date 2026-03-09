import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { ToolContext, ToolSpec } from "../types.js";
import {
  appendProcessOutput,
  createProcessSession,
  drainProcessOutput,
  finishProcessSession,
  getRunningProcessSession,
  markProcessBackgrounded,
  type ProcessSession,
  waitForProcessUpdate,
} from "../processRegistry.js";

const DEFAULT_YIELD_MS = 10_000;
const DEFAULT_TIMEOUT_SEC = 1_800;

function resolveShell(command: string): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    const shell = process.env.ComSpec || "cmd.exe";
    return { shell, args: ["/d", "/s", "/c", command] };
  }
  return {
    shell: process.env.SHELL || "/bin/sh",
    args: ["-lc", command],
  };
}

function normalizeEnv(rawEnv: unknown): Record<string, string> {
  if (!rawEnv || typeof rawEnv !== "object" || Array.isArray(rawEnv)) {
    return {};
  }
  const nextEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawEnv as Record<string, unknown>)) {
    if (typeof value === "string") {
      nextEnv[key] = value;
    }
  }
  return nextEnv;
}

function buildCompletedContent(session: ProcessSession, stdout: string, stderr: string): string {
  const lines: string[] = [
    `Command ${session.status} (${session.exitCode ?? 0}${session.exitSignal ? `, ${session.exitSignal}` : ""}).`,
  ];
  if (stdout) {
    lines.push(stdout);
  }
  if (stderr) {
    lines.push(stderr);
  }
  if (!stdout && !stderr) {
    lines.push("Command completed with no output.");
  }
  return lines.join("\n");
}

function buildRunningContent(session: ProcessSession, stdout: string, stderr: string, ptyRequested: boolean): string {
  const lines: string[] = [`Background session started: ${session.id}`];
  if (ptyRequested) {
    lines.push("PTY is not supported in this runtime; running with plain pipes.");
  }
  if (stdout) {
    lines.push(stdout);
  }
  if (stderr) {
    lines.push(stderr);
  }
  return lines.join("\n");
}

function terminateSessionOnAbort(signal: AbortSignal | undefined, child: ChildProcessWithoutNullStreams): () => void {
  if (!signal) {
    return () => {};
  }
  const handleAbort = () => {
    child.kill("SIGTERM");
  };
  signal.addEventListener("abort", handleAbort, { once: true });
  return () => signal.removeEventListener("abort", handleAbort);
}

async function waitForSessionExitOrYield(session: ProcessSession, yieldMs: number): Promise<"exited" | "yielded"> {
  const startedAt = Date.now();
  while (!session.exited) {
    const remaining = yieldMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      return "yielded";
    }
    await waitForProcessUpdate(session, remaining);
  }
  return "exited";
}

export const execTool: ToolSpec = {
  name: "exec",
  description: "执行 shell 命令；可在超时后转为后台会话，由 process 工具继续管理。",
  inputSchema: {
    type: "object",
    required: ["command"],
    properties: {
      command: {
        type: "string",
        description: "要执行的 shell 命令。",
      },
      workdir: {
        type: "string",
        description: "工作目录，默认当前 cwd。",
      },
      env: {
        type: "object",
        description: "附加环境变量。",
      },
      yieldMs: {
        type: "number",
        description: `前台等待毫秒数，默认 ${DEFAULT_YIELD_MS}；超时后转后台。`,
      },
      background: {
        type: "boolean",
        description: "是否立刻转为后台运行。",
      },
      timeout: {
        type: "number",
        description: `超时秒数，默认 ${DEFAULT_TIMEOUT_SEC}。`,
      },
      pty: {
        type: "boolean",
        description: "保留兼容字段；当前实现不提供 PTY。",
      },
    },
  },
  handler: async (context: ToolContext, args: Record<string, unknown>) => {
    if (typeof args.command !== "string" || !args.command.trim()) {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "exec",
          message: "command must be a non-empty string",
        },
      };
    }

    const workdir =
      typeof args.workdir === "string" && args.workdir.trim() ? args.workdir : context.cwd || process.cwd();
    const env = {
      ...process.env,
      ...normalizeEnv(args.env),
    };
    const yieldMs =
      typeof args.yieldMs === "number" && Number.isFinite(args.yieldMs) && args.yieldMs >= 0
        ? Math.floor(args.yieldMs)
        : DEFAULT_YIELD_MS;
    const timeoutSec =
      typeof args.timeout === "number" && Number.isFinite(args.timeout) && args.timeout > 0
        ? args.timeout
        : DEFAULT_TIMEOUT_SEC;

    try {
      const shell = resolveShell(args.command);
      const child = spawn(shell.shell, shell.args, {
        cwd: workdir,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const session = createProcessSession({
        sessionKey: context.sessionKey || context.sessionId || "default",
        command: args.command,
        cwd: workdir,
        child,
      });

      let timeoutHandle: NodeJS.Timeout | undefined;
      let killedByTimeout = false;
      const cleanupAbort = terminateSessionOnAbort(context.signal, child);

      child.stdout.on("data", (chunk: Buffer | string) => {
        appendProcessOutput(session, "stdout", chunk.toString());
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        appendProcessOutput(session, "stderr", chunk.toString());
      });
      child.on("error", (error) => {
        appendProcessOutput(session, "stderr", `${error.message}\n`);
      });
      child.on("close", (code, signal) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        cleanupAbort();
        finishProcessSession(
          session,
          killedByTimeout ? "killed" : code === 0 ? "completed" : "failed",
          code,
          signal,
        );
      });

      timeoutHandle = setTimeout(() => {
        if (!session.exited && getRunningProcessSession(session.id)) {
          killedByTimeout = true;
          child.kill("SIGTERM");
        }
      }, Math.max(1, Math.floor(timeoutSec * 1000)));

      if (args.background === true) {
        markProcessBackgrounded(session);
        const output = drainProcessOutput(session);
        cleanupAbort();
        return {
          ok: true,
          content: buildRunningContent(session, output.stdout, output.stderr, args.pty === true),
          data: {
            sessionId: session.id,
            status: session.status,
            pid: child.pid,
            background: true,
          },
        };
      }

      const state = await waitForSessionExitOrYield(session, yieldMs);
      const output = drainProcessOutput(session);
      if (state === "exited") {
        return {
          ok: true,
          content: buildCompletedContent(session, output.stdout, output.stderr),
          data: {
            sessionId: session.id,
            status: session.status,
            exitCode: session.exitCode ?? null,
            exitSignal: session.exitSignal ?? null,
            pid: child.pid,
            background: false,
          },
        };
      }

      markProcessBackgrounded(session);
      cleanupAbort();
      return {
        ok: true,
        content: buildRunningContent(session, output.stdout, output.stderr, args.pty === true),
        data: {
          sessionId: session.id,
          status: session.status,
          pid: child.pid,
          background: true,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "exec",
          message: error instanceof Error ? error.message : "failed to execute command",
        },
      };
    }
  },
};
