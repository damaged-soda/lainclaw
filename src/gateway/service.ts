import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveAuthDirectory } from "../auth/configStore.js";

export interface GatewayServiceState {
  channel: string;
  pid: number;
  startedAt: string;
  command: string;
  statePath: string;
  logPath: string;
  argv: string[];
}

export interface GatewayServicePaths {
  statePath: string;
  logPath: string;
}

export interface GatewayServiceTerminateOptions {
  gracefulTimeoutMs?: number;
  forceKillTimeoutMs?: number;
}

const DEFAULT_CHANNEL = "unknown";
const DEFAULT_STATE_FILE_SUFFIX = ".json";
const DEFAULT_LOG_FILE_SUFFIX = ".log";
const DEFAULT_GRACEFUL_TIMEOUT_MS = 5000;
const DEFAULT_FORCE_KILL_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 200;

function normalizeChannel(rawChannel: string | undefined): string {
  const trimmed = (rawChannel || "").trim().toLowerCase();
  if (!trimmed) {
    return DEFAULT_CHANNEL;
  }
  return trimmed.replace(/[^a-z0-9._-]+/g, "-");
}

export function resolveGatewayServicePaths(
  rawChannel: string,
  overrides: Partial<GatewayServicePaths> = {},
): GatewayServicePaths {
  const channel = normalizeChannel(rawChannel);
  const serviceDir = path.join(resolveAuthDirectory(), "service");

  return {
    statePath: overrides.statePath
      ? path.resolve(overrides.statePath)
      : path.join(serviceDir, `${channel}-gateway-service${DEFAULT_STATE_FILE_SUFFIX}`),
    logPath: overrides.logPath
      ? path.resolve(overrides.logPath)
      : path.join(serviceDir, `${channel}-gateway-service${DEFAULT_LOG_FILE_SUFFIX}`),
  };
}

function isGatewayServiceState(raw: unknown): raw is GatewayServiceState {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const candidate = raw as Partial<GatewayServiceState>;
  if (typeof candidate.channel !== "string" || !candidate.channel.trim()) {
    return false;
  }
  if (typeof candidate.pid !== "number" || !Number.isInteger(candidate.pid) || candidate.pid <= 0) {
    return false;
  }
  if (typeof candidate.startedAt !== "string" || candidate.startedAt.trim().length === 0) {
    return false;
  }
  if (typeof candidate.command !== "string" || candidate.command.trim().length === 0) {
    return false;
  }
  if (typeof candidate.statePath !== "string" || candidate.statePath.trim().length === 0) {
    return false;
  }
  if (typeof candidate.logPath !== "string" || candidate.logPath.trim().length === 0) {
    return false;
  }
  if (!Array.isArray(candidate.argv) || candidate.argv.length === 0) {
    return false;
  }
  return true;
}

export async function readGatewayServiceState(statePath: string): Promise<GatewayServiceState | null> {
  try {
    const raw = await fsp.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!isGatewayServiceState(parsed)) {
      return null;
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    return null;
  }
}

export async function writeGatewayServiceState(state: GatewayServiceState): Promise<void> {
  await fsp.mkdir(path.dirname(state.statePath), { recursive: true, mode: 0o700 });
  const tempPath = `${state.statePath}.tmp`;
  await fsp.writeFile(tempPath, JSON.stringify(state, null, 2), { encoding: "utf-8", mode: 0o600 });
  await fsp.rename(tempPath, state.statePath);
}

export async function clearGatewayServiceState(statePath: string): Promise<void> {
  try {
    await fsp.unlink(statePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return false;
    }
    if (code === "EPERM") {
      return true;
    }
    return false;
  }
}

export async function spawnGatewayServiceProcess(
  scriptPath: string,
  argv: string[],
  paths: GatewayServicePaths,
): Promise<number> {
  await fsp.mkdir(path.dirname(paths.logPath), { recursive: true, mode: 0o700 });
  let fd = -1;
  try {
    fd = fs.openSync(paths.logPath, "a");
    const child = spawn(process.execPath, [scriptPath, ...argv], {
      detached: true,
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", fd, fd],
    });

    const childPid = child.pid;
    if (!childPid) {
      throw new Error("Failed to spawn gateway child process.");
    }

    child.unref();
    return childPid;
  } finally {
    if (fd >= 0) {
      fs.closeSync(fd);
    }
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return !isProcessAlive(pid);
}

export async function terminateGatewayProcess(
  pid: number,
  options: GatewayServiceTerminateOptions = {},
): Promise<boolean> {
  const gracefulTimeoutMs = options.gracefulTimeoutMs ?? DEFAULT_GRACEFUL_TIMEOUT_MS;
  const forceKillTimeoutMs = options.forceKillTimeoutMs ?? DEFAULT_FORCE_KILL_TIMEOUT_MS;

  if (!isProcessAlive(pid)) {
    return true;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return true;
    }
    if (code === "EPERM") {
      throw error;
    }
  }

  if (await waitForProcessExit(pid, gracefulTimeoutMs)) {
    return true;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return true;
    }
    if (code === "EPERM") {
      throw error;
    }
  }

  return waitForProcessExit(pid, forceKillTimeoutMs);
}
