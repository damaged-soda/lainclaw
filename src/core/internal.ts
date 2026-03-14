import type { CoreEventSink, CoreRuntimePort, CoreSessionPort, CoreToolsPort } from "./contracts.js";
import type { RuntimeAgentEventSink, RuntimeContinueReason, RuntimeRunMode } from "../shared/types.js";

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
  onAgentEvent?: RuntimeAgentEventSink;
  emitEvent: CoreEventSink;
  sessionAdapter: CoreSessionPort;
  toolsAdapter: CoreToolsPort;
  runtimeAdapter: CoreRuntimePort;
};
