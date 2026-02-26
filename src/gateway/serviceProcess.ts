import fs from "node:fs";
import fsp from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import type { GatewayServicePaths } from "./servicePaths.js";
import type { GatewayServiceTerminateOptions } from "./servicePaths.js";

const POLL_INTERVAL_MS = 200;
const DEFAULT_GRACEFUL_TIMEOUT_MS = 5000;
const DEFAULT_FORCE_KILL_TIMEOUT_MS = 2000;
const KILL_SIGNALS = {
  graceful: "SIGTERM" as NodeJS.Signals,
  force: "SIGKILL" as NodeJS.Signals,
};

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

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  process.kill(pid, signal);
}

function handleProcessKillError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ESRCH") {
    return true;
  }
  if (code === "EPERM") {
    throw error;
  }
  return false;
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
    signalProcess(pid, KILL_SIGNALS.graceful);
  } catch (error) {
    if (handleProcessKillError(error)) {
      return true;
    }
  }

  if (await waitForProcessExit(pid, gracefulTimeoutMs)) {
    return true;
  }

  try {
    signalProcess(pid, KILL_SIGNALS.force);
  } catch (error) {
    if (handleProcessKillError(error)) {
      return true;
    }
  }

  return waitForProcessExit(pid, forceKillTimeoutMs);
}
