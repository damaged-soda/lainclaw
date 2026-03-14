import type { AgentEvent } from "@mariozechner/pi-agent-core";
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

export type RuntimeRunMode = "prompt" | "continue";

export type RuntimeContinueReason = "tool_result" | "restore_resume" | "retry";

export interface RequestContext {
  requestId: string;
  createdAt: string;
  input: string;
  sessionKey: string;
  sessionId: string;
  bootstrapMessages?: Message[];
  memorySnippet?: string;
  contextMessageLimit?: number;
  systemPrompt?: string;
  tools?: ContextToolSpec[];
  provider: string;
  profileId: string;
  runMode: RuntimeRunMode;
  continueReason?: RuntimeContinueReason;
  memoryEnabled?: boolean;
  debug?: boolean;
}

export interface RuntimeAgentEvent {
  requestId: string;
  sessionKey: string;
  sessionId: string;
  route: string;
  provider: string;
  profileId: string;
  event: AgentEvent;
}

export type RuntimeAgentEventSink = (event: RuntimeAgentEvent) => Promise<void> | void;

export interface SessionHistoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: string;
  content: string;
}

export class ValidationError extends Error {
  public readonly code: string;
  constructor(message: string, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}
