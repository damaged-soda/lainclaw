import readline from "node:readline";
import { loginOpenAICodex, getOAuthApiKey } from "@mariozechner/pi-ai";
import type { OAuthCredentials } from "@mariozechner/pi-ai";
import { loadAuthStore, saveAuthStore, resolveAuthFilePath } from "./configStore.js";
import type { AuthProfile, AuthStore } from "./types.js";

const OPENAI_CODEX_PROVIDER = "openai-codex";
const OPENAI_CODEX_MODEL = "gpt-5.3-codex";

export { OPENAI_CODEX_PROVIDER, OPENAI_CODEX_MODEL };

function nowIso() {
  return new Date().toISOString();
}

function profileIdForAccount(accountId?: string) {
  return accountId ? `${OPENAI_CODEX_PROVIDER}/${accountId}` : `${OPENAI_CODEX_PROVIDER}/default`;
}

async function prompt(message: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`${message} `, (answer) => {
      rl.close();
      resolve((answer ?? "").trim());
    });
  });
}

function uniqueProfileId(store: AuthStore, baseId: string): string {
  if (!store.profiles[baseId]) {
    return baseId;
  }
  let suffix = 2;
  while (store.profiles[`${baseId}#${suffix}`]) {
    suffix += 1;
  }
  return `${baseId}#${suffix}`;
}

function isOpenAICodexProfile(profile: AuthProfile) {
  return profile.provider === OPENAI_CODEX_PROVIDER;
}

function normalizeStore(store: AuthStore): AuthStore {
  const output: AuthStore = {
    version: 1,
    profiles: {},
  };
  if (store.activeProfileId) {
    output.activeProfileId = store.activeProfileId;
  }
  for (const [id, profile] of Object.entries(store.profiles || {})) {
    if (!profile?.provider || !profile?.id || !profile?.credential?.access) {
      continue;
    }
    output.profiles[id] = {
      id: profile.id,
      provider: profile.provider,
      createdAt: profile.createdAt || nowIso(),
      updatedAt: profile.updatedAt || nowIso(),
      credential: profile.credential,
    };
  }
  return output;
}

export async function getAuthProfiles(): Promise<AuthProfile[]> {
  const store = normalizeStore(await loadAuthStore());
  return Object.values(store.profiles).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getAuthStorePath(): Promise<string> {
  return resolveAuthFilePath();
}

export async function getOpenAICodexApiContext(profileId?: string): Promise<{
  apiKey: string;
  profile: AuthProfile;
}> {
  const store = normalizeStore(await loadAuthStore());
  const profile = findProfile(store, profileId);
  if (!profile) {
    throw new Error("No openai-codex profile found. Run: lainclaw auth login openai-codex");
  }

  const credentialsMap: Record<string, OAuthCredentials> = {
    [OPENAI_CODEX_PROVIDER]: profile.credential,
  };
  const result = await getOAuthApiKey(OPENAI_CODEX_PROVIDER, credentialsMap);
  if (!result) {
    throw new Error("Failed to read OAuth credentials for openai-codex");
  }

  if (result.newCredentials.access !== profile.credential.access) {
    profile.credential.access = result.newCredentials.access;
    profile.credential.refresh = result.newCredentials.refresh;
    profile.credential.expires = result.newCredentials.expires;
    profile.credential.accountId =
      typeof result.newCredentials.accountId === "string" && result.newCredentials.accountId.length > 0
        ? result.newCredentials.accountId
        : profile.credential.accountId;
    profile.updatedAt = nowIso();
    store.profiles[profile.id] = profile;
    await saveAuthStore(store);
  }
  return {
    apiKey: result.apiKey,
    profile,
  };
}

function findProfile(store: AuthStore, profileId?: string): AuthProfile | null {
  const entries = Object.values(store.profiles);
  if (profileId) {
    const exact = store.profiles[profileId];
    if (exact && exact.provider === OPENAI_CODEX_PROVIDER) {
      return exact;
    }
    throw new Error(`Profile ${profileId} not found for openai-codex`);
  }

  if (store.activeProfileId && store.profiles[store.activeProfileId]?.provider === OPENAI_CODEX_PROVIDER) {
    return store.profiles[store.activeProfileId];
  }

  const first = entries.find(isOpenAICodexProfile);
  if (first) {
    return first;
  }
  return null;
}

export async function setActiveProfile(profileId: string): Promise<AuthProfile> {
  const store = normalizeStore(await loadAuthStore());
  const target = store.profiles[profileId];
  if (!target || target.provider !== OPENAI_CODEX_PROVIDER) {
    throw new Error(`Profile ${profileId} not found`);
  }
  store.activeProfileId = profileId;
  await saveAuthStore(store);
  return target;
}

export async function logoutProfile(profileId?: string): Promise<string | null> {
  const store = normalizeStore(await loadAuthStore());
  if (!profileId) {
    if (!store.activeProfileId) {
      return null;
    }
    profileId = store.activeProfileId;
  }

  if (!store.profiles[profileId]) {
    throw new Error(`Profile ${profileId} not found`);
  }
  delete store.profiles[profileId];
  if (store.activeProfileId === profileId) {
    store.activeProfileId = undefined;
  }
  await saveAuthStore(store);
  return profileId;
}

export async function clearProfiles(): Promise<void> {
  await saveAuthStore({
    version: 1,
    profiles: {},
  });
}

export async function loginOpenAICodexProfile() {
  if (!process.stdin.isTTY) {
    throw new Error("openai-codex login requires an interactive terminal.");
  }
  const store = normalizeStore(await loadAuthStore());

  const credentials = await loginOpenAICodex({
    onAuth: ({ url, instructions }) => {
      console.log(`Open URL in browser: ${url}`);
      if (instructions) {
        console.log(instructions);
      }
    },
    onPrompt: async ({ message }) => {
      return prompt(`${message}`);
    },
    onManualCodeInput: () => prompt("Paste the authorization code (or full redirect URL):"),
  });

  const profileId = uniqueProfileId(
    store,
    profileIdForAccount((credentials as { accountId?: string }).accountId ?? undefined),
  );
  const current = store.profiles[profileId];
  const now = nowIso();
  const nextProfile: AuthProfile = {
    id: profileId,
    provider: OPENAI_CODEX_PROVIDER,
    createdAt: current?.createdAt || now,
    updatedAt: now,
    credential: {
      access: credentials.access,
      refresh: credentials.refresh,
      expires: credentials.expires,
      accountId: typeof credentials.accountId === "string" ? credentials.accountId : undefined,
    },
  };
  store.profiles[profileId] = nextProfile;
  store.activeProfileId = profileId;
  await saveAuthStore(store);
  return nextProfile;
}

export async function getAuthStatus() {
  const profiles = await getAuthProfiles();
  const store = normalizeStore(await loadAuthStore());
  return {
    activeProfileId: store.activeProfileId,
    profiles: profiles.filter(isOpenAICodexProfile),
  };
}

export function formatProfileExpiry(profile: AuthProfile): string {
  const remaining = profile.credential.expires - Date.now();
  if (remaining <= 0) {
    return "expired";
  }
  const minutes = Math.floor(remaining / 60000);
  return `${minutes}m`;
}
