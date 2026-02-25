import fsp from "node:fs/promises";
import path from "node:path";
import type { GatewayServiceState } from "./servicePaths.js";

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
  if (Array.isArray(candidate.channels)) {
    if (candidate.channels.length === 0) {
      return false;
    }
    if (!candidate.channels.every((item) => typeof item === "string" && item.trim().length > 0)) {
      return false;
    }
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
