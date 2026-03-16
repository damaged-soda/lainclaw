import fs from "node:fs/promises";
import path from "node:path";
import { runAgent } from "../agent/invoke.js";
import { resolveAuthDirectory } from "../auth/configStore.js";
import type { GatewayAgentRuntimeContext } from "./runtimeConfig.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000;
const HEARTBEAT_FILE_NAME = "HEARTBEAT.md";
const HEARTBEAT_SESSION_KEY = "heartbeat";
const HEARTBEAT_OK_TOKEN = "HEARTBEAT_OK";
const EMPTY_CHECKBOX_LINES = new Set(["- [ ]", "* [ ]", "- [x]", "* [x]"]);

function formatTimezoneOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60).toString().padStart(2, "0");
  const minutes = (absoluteMinutes % 60).toString().padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function formatHeartbeatTime(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${formatTimezoneOffset(date)}`;
}

function normalizeIntervalMs(raw: string | undefined): number {
  if (!raw?.trim()) {
    return DEFAULT_HEARTBEAT_INTERVAL_MS;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HEARTBEAT_INTERVAL_MS;
  }
  return parsed;
}

function isHeartbeatEmpty(content: string | null): boolean {
  if (!content?.trim()) {
    return true;
  }

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith("#") || line.startsWith("<!--")) {
      continue;
    }
    if (EMPTY_CHECKBOX_LINES.has(line)) {
      continue;
    }
    return false;
  }

  return true;
}

function buildHeartbeatPrompt(content: string, now = new Date()): string {
  const heartbeatTime = formatHeartbeatTime(now);
  return [
    "这是一次 heartbeat 触发，不是用户主动消息。",
    `本次 heartbeat 当前时间（北京时间 Asia/Shanghai）：${heartbeatTime}`,
    "判断任何时间窗口时，必须以这个时间为准，不要使用历史上下文中的旧时间。",
    "严格根据下面的 HEARTBEAT.md 内容执行任务。",
    "如需主动通知外部用户，请使用 send_message 工具。",
    `如果没有需要做的事情，回复 ${HEARTBEAT_OK_TOKEN}。`,
    "",
    "# HEARTBEAT.md",
    "",
    content.trim(),
  ].join("\n");
}

export function resolveHeartbeatFilePath(homeDir = process.env.HOME): string {
  const authDirectory = typeof homeDir === "string" && homeDir.trim().length > 0
    ? resolveAuthDirectory(homeDir)
    : resolveAuthDirectory();
  return path.join(authDirectory, HEARTBEAT_FILE_NAME);
}

async function readHeartbeatPrompt(): Promise<string | null> {
  const heartbeatPath = resolveHeartbeatFilePath();
  try {
    const content = await fs.readFile(heartbeatPath, "utf8");
    if (isHeartbeatEmpty(content)) {
      return null;
    }
    return buildHeartbeatPrompt(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export interface HeartbeatRunnerHandle {
  stop(): void;
}

export interface StartHeartbeatRunnerOptions {
  cwd: string;
  runtime: GatewayAgentRuntimeContext;
  intervalMs?: number;
  runAgentFn?: typeof runAgent;
}

export function resolveHeartbeatIntervalMs(): number {
  return normalizeIntervalMs(process.env.LAINCLAW_HEARTBEAT_INTERVAL_MS);
}

export function startHeartbeatRunner(options: StartHeartbeatRunnerOptions): HeartbeatRunnerHandle {
  const runAgentFn = options.runAgentFn ?? runAgent;
  const intervalMs = options.intervalMs ?? resolveHeartbeatIntervalMs();
  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  const scheduleNext = () => {
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      void tick();
    }, intervalMs);
    timer.unref?.();
  };

  const tick = async () => {
    if (stopped) {
      return;
    }
    if (running) {
      scheduleNext();
      return;
    }

    running = true;
    try {
      const prompt = await readHeartbeatPrompt();
      if (!prompt) {
        return;
      }

      await runAgentFn({
        input: prompt,
        channelId: "heartbeat",
        sessionKey: HEARTBEAT_SESSION_KEY,
        runtime: {
          ...options.runtime,
          cwd: options.cwd,
          memory: false,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[heartbeat] ${message}`);
    } finally {
      running = false;
      scheduleNext();
    }
  };

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

export { HEARTBEAT_OK_TOKEN };
