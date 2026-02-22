export interface RequestContext {
  requestId: string;
  createdAt: string;
  input: string;
}

export interface PipelineResult {
  requestId: string;
  createdAt: string;
  route: string;
  stage: string;
  result: string;
}

export interface GatewayResult {
  success: boolean;
  requestId: string;
  createdAt: string;
  route: string;
  stage: string;
  result: string;
}

export class ValidationError extends Error {
  public readonly code: string;
  constructor(message: string, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

