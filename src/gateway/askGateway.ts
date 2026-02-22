import { GatewayResult, RequestContext, ValidationError, PipelineResult } from '../shared/types.js';
import { runPipeline } from '../pipeline/pipeline.js';

function createRequestId() {
  const now = Date.now();
  const suffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `lc-${now}-${suffix}`;
}

function nowIso() {
  return new Date().toISOString();
}

export async function runAsk(rawInput: string, opts: { provider?: string; profileId?: string } = {}): Promise<GatewayResult> {
  if (!rawInput || !rawInput.trim()) {
    throw new ValidationError('ask command requires non-empty input', 'ASK_INPUT_REQUIRED');
  }

  const context: RequestContext = {
    requestId: createRequestId(),
    createdAt: nowIso(),
    input: rawInput.trim(),
    ...(opts.provider ? { provider: opts.provider } : {}),
    ...(opts.profileId ? { profileId: opts.profileId } : {}),
  };

  const pipelineOutput = await runPipeline(context);
  const adapter = pipelineOutput.adapter;
  const result: PipelineResult = {
    requestId: context.requestId,
    createdAt: context.createdAt,
    route: adapter.route,
    stage: adapter.stage,
    result: adapter.result,
    ...(adapter.provider ? { provider: adapter.provider } : {}),
    ...(adapter.profileId ? { profileId: adapter.profileId } : {}),
  };

  return {
    success: true,
    requestId: context.requestId,
    createdAt: context.createdAt,
    route: result.route,
    stage: result.stage,
    result: result.result,
    ...(result.provider ? { provider: result.provider } : {}),
    ...(result.profileId ? { profileId: result.profileId } : {}),
  };
}
