import fs from "node:fs/promises";
import path from "node:path";
import type { AuthProfile, AuthStore } from "./types.js";
import { resolvePaths, resolveRuntimePaths } from "../paths/index.js";

const AUTH_FILE_NAME = "auth-profiles.json";
const CURRENT_VERSION = 1 as const;

export function resolveAuthFilePath(homeDir?: string): string {
  if (typeof homeDir === "string") {
    return resolvePaths(homeDir).authProfiles;
  }
  return resolveRuntimePaths().authProfiles;
}

function toAuthStore(raw: unknown): AuthStore {
  const candidate = raw as Partial<AuthStore> | undefined;
  const store: AuthStore = {
    version: CURRENT_VERSION,
    profiles: {},
  };

  if (candidate?.activeProfileId && typeof candidate.activeProfileId === "string") {
    store.activeProfileId = candidate.activeProfileId;
  }

  const profiles = candidate?.profiles;
  if (profiles && typeof profiles === "object") {
    for (const key of Object.keys(profiles)) {
      const profile = (profiles as Record<string, unknown>)[key];
      if (!profile || typeof profile !== "object") {
        continue;
      }

      const p = profile as Partial<AuthProfile>;
      if (typeof p.id !== "string" || typeof p.provider !== "string") {
        continue;
      }

      const rawCredential = p.credential as Partial<AuthProfile["credential"]> | undefined;
      if (!rawCredential || typeof rawCredential.access !== "string" || typeof rawCredential.refresh !== "string") {
        continue;
      }

      const expires = typeof rawCredential.expires === "number" ? rawCredential.expires : NaN;
      if (!Number.isFinite(expires) || expires <= 0) {
        continue;
      }

      const profileId = p.id;
      const credential = {
        access: rawCredential.access,
        refresh: rawCredential.refresh,
        expires,
        ...(rawCredential.accountId && typeof rawCredential.accountId === "string"
          ? { accountId: rawCredential.accountId }
          : {}),
      };

      const createdAt = p.createdAt && typeof p.createdAt === "string" ? p.createdAt : new Date().toISOString();
      const updatedAt = p.updatedAt && typeof p.updatedAt === "string" ? p.updatedAt : createdAt;

      store.profiles[profileId] = {
        id: profileId,
        provider: p.provider,
        createdAt,
        updatedAt,
        credential,
      };
    }
  }

  return store;
}

export async function loadAuthStore(): Promise<AuthStore> {
  const authFile = resolveAuthFilePath();

  try {
    const raw = await fs.readFile(authFile, "utf-8");
    const parsed = JSON.parse(raw);
    return toAuthStore(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        version: CURRENT_VERSION,
        profiles: {},
      };
    }
    throw error;
  }
}

function formatJsonWithSafeKeys(store: AuthStore): string {
  return JSON.stringify(store, null, 2);
}

export async function saveAuthStore(store: AuthStore): Promise<void> {
  const authFile = resolveAuthFilePath();
  const authDir = path.dirname(authFile);
  await fs.mkdir(authDir, { recursive: true, mode: 0o700 });
  const tempFile = `${authFile}.tmp`;
  await fs.writeFile(tempFile, formatJsonWithSafeKeys(store), {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.rename(tempFile, authFile);
}
