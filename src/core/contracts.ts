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

export interface CoreContextToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    required?: string[];
    properties: Record<string, {
      type: "string" | "number" | "boolean" | "object" | "array";
      description?: string;
    }>;
  };
}

export type CoreToolSpec = CoreContextToolSpec;

export type CoreToolErrorCode = "tool_not_found" | "invalid_args" | "execution_error";

export interface CoreToolError {
  code: CoreToolErrorCode;
  tool: string;
  message: string;
}

export interface CoreToolCall {
  id: string;
  name: string;
  args?: unknown;
  source?: string;
}

export interface CoreToolResult {
  ok: boolean;
  content?: string;
  data?: unknown;
  error?: CoreToolError;
  meta?: {
    tool: string;
    durationMs: number;
  };
}

export interface CoreToolExecutionLog {
  call: CoreToolCall;
  result: CoreToolResult;
}

export interface CoreToolContext {
  requestId: string;
  sessionId: string;
  sessionKey: string;
  cwd: string;
  signal?: AbortSignal;
}

export interface CoreToolQueryOptions {
  allowList?: string[];
}

export interface CoreToolsPort {
  listTools(options?: CoreToolQueryOptions): CoreToolSpec[];
  executeTool(call: CoreToolCall, context: CoreToolContext): Promise<CoreToolExecutionLog>;
  firstToolErrorFromLogs(logs: CoreToolExecutionLog[] | undefined): CoreToolError | undefined;
}

export interface CoreSessionTurnResult {
  route: string;
  stage: string;
  result: string;
  provider: string;
  profileId: string;
}

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

export interface CoreSessionHistoryMessage {
  id: string;
  role: "user" | "assistant" | "system";
  timestamp: string;
  content: string;
}

export interface CoreSessionPort {
  resolveSession(input: CoreSessionLoadInput): Promise<CoreSessionRecord>;
  loadHistory(sessionId: string): Promise<CoreSessionHistoryMessage[]>;
  loadMemorySnippet(sessionKey: string): Promise<string>;
  appendTurnMessages(
    sessionId: string,
    userInput: string,
    finalResult: CoreSessionTurnResult,
  ): Promise<void>;
  appendToolSummary(
    sessionId: string,
    toolCalls: CoreToolCall[],
    toolResults: CoreToolExecutionLog[],
    route: string,
    stage: string,
    provider: string,
    profileId: string,
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
  memory?: boolean;
  withTools: boolean;
  toolAllow: string[];
  cwd?: string;
}

export interface CoreRuntimeInput {
  requestId: string;
  createdAt: string;
  input: string;
  sessionKey: string;
  sessionId: string;
  priorMessages: CoreSessionHistoryMessage[];
  memorySnippet: string;
  provider: string;
  profileId: string;
  withTools: boolean;
  toolAllow: string[];
  tools?: CoreContextToolSpec[];
  systemPrompt?: string;
  memoryEnabled?: boolean;
  cwd?: string;
}

export interface CoreRuntimeResult {
  route: string;
  stage: string;
  result: string;
  toolCalls?: CoreToolCall[];
  toolResults?: CoreToolExecutionLog[];
  assistantMessage?: unknown;
  stopReason?: string;
  provider: string;
  profileId: string;
}

export interface CoreRuntimePort {
  run(input: CoreRuntimeInput): Promise<CoreRuntimeResult>;
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
