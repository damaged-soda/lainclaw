import fsp from "node:fs/promises";
import path from "node:path";
import type { GatewayServiceState } from "./servicePaths.js";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStrictPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isStringArray(values: unknown): values is string[] {
  if (!Array.isArray(values) || values.length === 0) {
    return false;
  }
  return values.every((value) => typeof value === "string" && value.trim().length > 0);
}

function isGatewayServiceStatePayload(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

function isGatewayServiceState(raw: unknown): raw is GatewayServiceState {
  if (!isGatewayServiceStatePayload(raw)) {
    return false;
  }
  const candidate = raw as Partial<GatewayServiceState>;
  if (!isNonEmptyString(candidate.channel)) {
    return false;
  }
  if (!isStrictPositiveInt(candidate.pid)) {
    return false;
  }
  if (!isNonEmptyString(candidate.startedAt)) {
    return false;
  }
  if (!isNonEmptyString(candidate.command)) {
    return false;
  }
  if (!isNonEmptyString(candidate.statePath)) {
    return false;
  }
  if (!isNonEmptyString(candidate.logPath)) {
    return false;
  }
  if (!Array.isArray(candidate.argv) || candidate.argv.length === 0) {
    return false;
  }
  if (candidate.channels !== undefined && !isStringArray(candidate.channels)) {
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
