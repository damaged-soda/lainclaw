import { runCodexAdapter } from "./codexAdapter.js";
import { runStubAdapter } from "./stubAdapter.js";
import type { AdapterResult } from "./stubAdapter.js";
import type { RequestContext } from "../shared/types.js";
import type { ContextToolSpec } from "../shared/types.js";

export interface AdapterRunInput {
  requestContext: RequestContext;
  route: string;
  withTools: boolean;
  toolAllow: string[];
  cwd?: string;
  toolSpecs?: ContextToolSpec[];
}

export type RuntimeAdapter = (input: AdapterRunInput) => Promise<AdapterResult>;

export interface ResolvedAdapter {
  provider: string;
  run: RuntimeAdapter;
}

function normalizeProvider(raw: string): string {
  return (raw || "").trim().toLowerCase();
}

const ADAPTER_BY_PROVIDER: Record<string, RuntimeAdapter> = {
  "openai-codex": runCodexAdapter,
  stub: runStubAdapter,
};

export function resolveAdapter(providerRaw: string): ResolvedAdapter {
  const normalized = normalizeProvider(providerRaw);
  const provider = normalized;
  if (!provider) {
    throw new Error("No provider provided. Please set --provider to a configured provider.");
  }

  const run = ADAPTER_BY_PROVIDER[provider];
  if (!run) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  return { provider, run };
}

export function getSupportedAdapters(): string[] {
  return Object.keys(ADAPTER_BY_PROVIDER).sort();
}
