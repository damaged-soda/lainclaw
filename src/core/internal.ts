import type { CoreToolsAdapter } from "./adapters/tools.js";
import type { CoreSessionAdapter } from "./adapters/session.js";
import type { CoreRuntimeAdapter } from "./adapters/runtime.js";
import type { CoreEventSink, CoreSessionHistoryMessage } from "./contracts.js";
import type { RuntimeContinueReason, RuntimeRunMode } from "../shared/types.js";

export type RunCtx = {
  requestId: string;
  createdAt: string;
  provider: string;
  profileId: string;
  sessionKey: string;
  runMode?: RuntimeRunMode;
  continueReason?: RuntimeContinueReason;
  withTools: boolean;
  memoryEnabled?: boolean;
  cwd?: string;
  debug?: boolean;
  emitEvent: CoreEventSink;
  sessionAdapter: CoreSessionAdapter;
  toolsAdapter: CoreToolsAdapter;
  runtimeAdapter: CoreRuntimeAdapter;
};

export type TurnContext = {
  memorySnippet: string;
  bootstrapMessages: CoreSessionHistoryMessage[];
  tools: ReturnType<CoreToolsAdapter["listTools"]>;
};
