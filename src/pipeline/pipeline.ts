import { RequestContext } from '../shared/types.js';
import { AdapterResult } from '../adapters/stubAdapter.js';
import { runStubAdapter } from '../adapters/stubAdapter.js';

interface RouteDecision {
  route: string;
}

function resolveRoute(input: string): RouteDecision {
  const normalized = input.toLowerCase();
  if (normalized.includes('总结') || normalized.includes('summary')) {
    return { route: 'summary' };
  }
  return { route: 'echo' };
}

export function runPipeline(context: RequestContext): { adapter: AdapterResult } {
  const decision = resolveRoute(context.input);
  const adapter = runStubAdapter(context, decision.route);
  return { adapter };
}
