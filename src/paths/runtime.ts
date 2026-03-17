import path from "node:path";
import { PATH_DEFS } from "./definitions.js";

export type ResolvedPaths = {
  [Key in keyof typeof PATH_DEFS]: string;
};

function normalizeHome(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("LAINCLAW_HOME must be a non-empty path.");
  }
  return path.resolve(trimmed);
}

export function resolveLainclawHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.LAINCLAW_HOME;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("LAINCLAW_HOME is required. Set LAINCLAW_HOME to the runtime root directory.");
  }
  return normalizeHome(raw);
}

export function resolvePaths(home: string): ResolvedPaths {
  const resolvedHome = normalizeHome(home);
  return Object.fromEntries(
    Object.entries(PATH_DEFS).map(([key, definition]) => [key, path.join(resolvedHome, definition.rel)]),
  ) as ResolvedPaths;
}

export function resolveRuntimePaths(env: NodeJS.ProcessEnv = process.env): ResolvedPaths {
  return resolvePaths(resolveLainclawHome(env));
}
