import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { AuthProfile, AuthStore } from "./types.js";

const AUTH_DIRECTORY_NAME = ".lainclaw";
const AUTH_FILE_NAME = "auth-profiles.json";
const CURRENT_VERSION = 1 as const;

export function resolveAuthDirectory(homeDir = os.homedir()): string {
  return path.join(homeDir, AUTH_DIRECTORY_NAME);
}

export function resolveAuthFilePath(homeDir = os.homedir()): string {
  return path.join(resolveAuthDirectory(homeDir), AUTH_FILE_NAME);
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
  const authDir = resolveAuthDirectory();
  const authFile = resolveAuthFilePath();
  await fs.mkdir(authDir, { recursive: true, mode: 0o700 });
  const tempFile = `${authFile}.tmp`;
  await fs.writeFile(tempFile, formatJsonWithSafeKeys(store), {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.rename(tempFile, authFile);
}

export { CURRENT_VERSION };
