import { runCodexAdapter } from "./codexAdapter.js";
import { runStubAdapter } from "./stubAdapter.js";
import type { ProviderResult } from "./stubAdapter.js";
import type { RequestContext } from "../shared/types.js";
import type { ContextToolSpec } from "../shared/types.js";

export interface ProviderRunInput {
  requestContext: RequestContext;
  route: string;
  withTools: boolean;
  toolAllow: string[];
  cwd?: string;
  toolSpecs?: ContextToolSpec[];
}

export type RuntimeProvider = (input: ProviderRunInput) => Promise<ProviderResult>;

export interface ResolvedProvider {
  provider: string;
  run: RuntimeProvider;
}

function normalizeProvider(raw: string): string {
  return (raw || "").trim().toLowerCase();
}

const PROVIDER_BY_PROVIDER: Record<string, RuntimeProvider> = {
  "openai-codex": runCodexAdapter,
  stub: runStubAdapter,
};

export function resolveProvider(providerRaw: string): ResolvedProvider {
  const normalized = normalizeProvider(providerRaw);
  const provider = normalized;
  if (!provider) {
    throw new Error("No provider provided. Please set --provider to a configured provider.");
  }

  const run = PROVIDER_BY_PROVIDER[provider];
  if (!run) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  return { provider, run };
}

export function getSupportedProviders(): string[] {
  return Object.keys(PROVIDER_BY_PROVIDER).sort();
}

export type AdapterRunInput = ProviderRunInput;
export type RuntimeAdapter = RuntimeProvider;
export type ResolvedAdapter = ResolvedProvider;
export const resolveAdapter = resolveProvider;
export function getSupportedAdapters(): string[] {
  return getSupportedProviders();
}
