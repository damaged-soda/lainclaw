export interface RequestContext {
  requestId: string;
  createdAt: string;
  input: string;
  sessionKey: string;
  sessionId: string;
  messages: SessionHistoryMessage[];
  provider?: string;
  profileId?: string;
  memoryEnabled?: boolean;
}

export interface PipelineResult {
  requestId: string;
  createdAt: string;
  route: string;
  stage: string;
  result: string;
  provider?: string;
  profileId?: string;
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
  sessionKey: string;
  sessionId: string;
  provider?: string;
  profileId?: string;
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
