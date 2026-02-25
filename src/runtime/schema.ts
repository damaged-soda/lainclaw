import type { Message as PiMessage } from "@mariozechner/pi-ai";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

export const RUNTIME_STATE_VERSION = 1;

export interface RuntimeModelRef {
  provider: string;
  id: string;
}

export interface RuntimeAgentStateSnapshot {
  systemPrompt: string;
  model: RuntimeModelRef;
  thinkingLevel: ThinkingLevel;
  tools: string[];
  messages: PiMessage[];
  isStreaming: boolean;
  streamMessage?: PiMessage | null;
  pendingToolCalls: string[];
  error?: string;
}

export type RuntimePhase = "idle" | "running" | "suspended" | "failed";

export interface RuntimeExecutionState {
  version: number;
  channel: string;
  sessionKey: string;
  sessionId: string;
  provider: string;
  profileId: string;
  runId: string;
  runCreatedAt: string;
  runUpdatedAt: string;
  phase: RuntimePhase;
  planId: string;
  stepId: number;
  toolRunId?: string;
  lastRequestId?: string;
  agentState?: RuntimeAgentStateSnapshot;
  lastError?: string;
  lastEventId?: string;
  lastGoodSnapshot?: {
    runId: string;
    updatedAt: string;
    stepId: number;
  };
}

export interface RuntimeStateEnvelope {
  current?: RuntimeExecutionState;
  history?: RuntimeExecutionState[];
}
