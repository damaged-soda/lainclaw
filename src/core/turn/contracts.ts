import type {
  CoreSessionPort,
  CoreSessionRecord,
} from "../contracts.js";
import type { ProviderResult, ProviderRunInput } from "../../providers/registry.js";
import type { AgentStateStore } from "../../runtime/agentStateStore.js";
import type { RuntimeContinueReason, RuntimeRunMode } from "../../shared/types.js";

export interface CoreTurnDependencies {
  sessionPort: CoreSessionPort;
  stateStore?: AgentStateStore;
}

export interface PrepareTurnInput {
  requestId: string;
  createdAt: string;
  input: string;
  sessionKey: string;
  provider: string;
  profileId: string;
  runMode?: RuntimeRunMode;
  continueReason?: RuntimeContinueReason;
  memoryEnabled?: boolean;
  withTools: boolean;
  cwd?: string;
  debug?: boolean;
  systemPrompt?: string;
  contextMessageLimit?: number;
}

export interface PreparedTurn {
  session: CoreSessionRecord;
  providerInput: Pick<ProviderRunInput, "requestContext" | "preparedState" | "withTools" | "cwd">;
}

export interface CommitTurnInput {
  preparedTurn: PreparedTurn;
  runtimeResult: ProviderResult;
}

export interface CommitTurnResult {
  memoryUpdated: boolean;
}
