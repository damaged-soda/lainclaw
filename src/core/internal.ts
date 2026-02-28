import type { CoreToolsAdapter } from "./adapters/tools.js";
import type { CoreSessionAdapter } from "./adapters/session.js";
import type { CoreRuntimeAdapter } from "./adapters/runtime.js";
import type { CoreEventSink, CoreSessionHistoryMessage } from "./contracts.js";

export type RunCtx = {
  requestId: string;
  createdAt: string;
  provider: string;
  profileId: string;
  sessionKey: string;
  withTools: boolean;
  toolAllow: string[];
  memoryEnabled?: boolean;
  cwd?: string;
  emitEvent: CoreEventSink;
  sessionAdapter: CoreSessionAdapter;
  toolsAdapter: CoreToolsAdapter;
  runtimeAdapter: CoreRuntimeAdapter;
};

export type TurnContext = {
  memorySnippet: string;
  priorMessages: CoreSessionHistoryMessage[];
  tools: ReturnType<CoreToolsAdapter["listTools"]>;
};
