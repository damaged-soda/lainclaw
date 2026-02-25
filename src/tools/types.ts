export interface ToolContext {
  requestId: string;
  sessionId: string;
  sessionKey: string;
  cwd: string;
  signal?: AbortSignal;
}

export interface ToolInputProperty {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
}

export interface ToolInputSchema {
  type: "object";
  required?: string[];
  properties: Record<string, ToolInputProperty>;
}

export type ToolErrorCode = "tool_not_found" | "invalid_args" | "execution_error";

export interface ToolError {
  code: ToolErrorCode;
  tool: string;
  message: string;
}

export interface ToolResult {
  ok: boolean;
  content?: string;
  data?: unknown;
  error?: ToolError;
  meta?: {
    tool: string;
    durationMs: number;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  args?: unknown;
  source?: string;
}

export interface ToolExecutionLog {
  call: ToolCall;
  result: ToolResult;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  handler: (context: ToolContext, args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
}
