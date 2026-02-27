import type { ToolCall, ToolError, ToolExecutionLog } from "../tools/types.js";
import type { Message } from "@mariozechner/pi-ai";

export interface ContextToolSpec {
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

export interface RequestContext {
  requestId: string;
  createdAt: string;
  input: string;
  sessionKey: string;
  sessionId: string;
  messages: Message[];
  systemPrompt?: string;
  tools?: ContextToolSpec[];
  provider: string;
  profileId: string;
  memoryEnabled?: boolean;
}

export interface PipelineResult {
  requestId: string;
  createdAt: string;
  route: string;
  stage: string;
  result: string;
  toolCalls?: ToolCall[];
  assistantMessage?: Message;
  stopReason?: string;
  provider: string;
  profileId: string;
}

export interface SessionHistoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: string;
  content: string;
}

export interface GatewayResult {
  success: boolean;
  requestId: string;
  createdAt: string;
  route: string;
  stage: string;
  result: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolExecutionLog[];
  toolError?: ToolError;
  sessionContextUpdated?: boolean;
  sessionKey: string;
  sessionId: string;
  provider: string;
  profileId: string;
  memoryEnabled: boolean;
  memoryUpdated: boolean;
  memoryFile?: string;
}

export class ValidationError extends Error {
  public readonly code: string;
  constructor(message: string, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}
