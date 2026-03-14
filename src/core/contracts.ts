import type {
  ContextToolSpec,
  RuntimeAgentEventSink,
  RuntimeContinueReason,
  RuntimeRunMode,
  SessionHistoryMessage,
} from "../shared/types.js";
import type { ProviderResult, ProviderRunInput } from "../providers/registry.js";
import type { ToolCall, ToolContext, ToolError, ToolExecutionLog } from "../tools/types.js";

export type CoreErrorCode =
  | "VALIDATION_ERROR"
  | "MISSING_PROVIDER"
  | "SESSION_FAILURE"
  | "RUNTIME_FAILURE"
  | "TOOL_FAILURE"
  | "INTERNAL_ERROR";

export interface CoreTraceEvent {
  level: "trace" | "event" | "log";
  requestId: string;
  at: string;
  code?: CoreErrorCode;
  name: string;
  message?: string;
  sessionKey?: string;
  route?: string;
  stage?: string;
  payload?: Record<string, unknown>;
}

export type CoreEventSink = (event: CoreTraceEvent) => Promise<void>;

export interface CoreToolsPort {
  listTools(): ContextToolSpec[];
  executeTool(call: ToolCall, context: ToolContext): Promise<ToolExecutionLog>;
  firstToolErrorFromLogs(logs: ToolExecutionLog[] | undefined): ToolError | undefined;
}

export type CoreSessionTurnResult = Pick<
  ProviderResult,
  "route" | "stage" | "result" | "provider" | "profileId"
>;

export interface CoreSessionRecord {
  sessionKey: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  isNewSession: boolean;
  memoryEnabled: boolean;
  compactedMessageCount: number;
}

export interface CoreSessionSnapshotCompact {
  sessionKey: string;
  sessionId: string;
  memoryEnabled: boolean;
  compactedMessageCount: number;
}

export interface CoreSessionLoadInput {
  sessionKey: string;
  provider: string;
  profileId: string;
  forceNew?: boolean;
  memory?: boolean;
}

export interface CoreSessionPort {
  resolveSession(input: CoreSessionLoadInput): Promise<CoreSessionRecord>;
  loadTranscriptMessages(sessionId: string): Promise<SessionHistoryMessage[]>;
  loadMemorySnippet(sessionKey: string): Promise<string>;
  appendTurnMessages(
    sessionId: string,
    userInput: string,
    finalResult: CoreSessionTurnResult,
    options?: {
      includeUserMessage?: boolean;
    },
  ): Promise<void>;
  markRouteUsage(sessionKey: string, route: string, profileId: string, provider: string): Promise<void>;
  compactIfNeeded(input: CoreSessionSnapshotCompact): Promise<boolean>;
  resolveSessionMemoryPath(sessionKey: string): string;
}

export interface CoreRunAgentOptions {
  provider: string;
  profileId: string;
  sessionKey: string;
  newSession?: boolean;
  runMode?: RuntimeRunMode;
  continueReason?: RuntimeContinueReason;
  memory?: boolean;
  withTools: boolean;
  cwd?: string;
  debug?: boolean;
  onAgentEvent?: RuntimeAgentEventSink;
}

export interface CoreRuntimePort {
  run(input: ProviderRunInput): Promise<ProviderResult>;
}

export type CoreOutcome = {
  requestId: string;
  sessionKey: string;
  sessionId: string;
  text: string;
  isNewSession?: boolean;
};

export type CoreAgentResult = CoreOutcome;

export interface CoreCoordinator {
  runAgent(rawInput: string, options: CoreRunAgentOptions): Promise<CoreAgentResult>;
}
