import type { Message } from "@mariozechner/pi-ai";
import { runCodexAdapter } from "./codexAdapter.js";
import { runStubAdapter } from "./stubAdapter.js";
import type {
  ContextToolSpec,
  RequestContext,
  RuntimeAgentEventSink,
  RuntimeContinueReason,
  RuntimeRunMode,
} from "../shared/types.js";
import type { ToolCall, ToolExecutionLog } from "../tools/types.js";

export interface ProviderPreparedState {
  source: "snapshot" | "transcript" | "new";
  initialMessages: Message[];
  initialSystemPrompt?: string;
}

export interface ProviderRunInput {
  requestContext: RequestContext;
  preparedState: ProviderPreparedState;
  withTools: boolean;
  cwd?: string;
  toolSpecs?: ContextToolSpec[];
  onAgentEvent?: RuntimeAgentEventSink;
}

export interface ProviderResult {
  route: string;
  stage: string;
  result: string;
  runMode: RuntimeRunMode;
  continueReason?: RuntimeContinueReason;
  toolCalls?: ToolCall[];
  toolResults?: ToolExecutionLog[];
  assistantMessage?: Message;
  stopReason?: string;
  provider: string;
  profileId: string;
  sessionState?: {
    systemPrompt: string;
    messages: Message[];
  };
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
