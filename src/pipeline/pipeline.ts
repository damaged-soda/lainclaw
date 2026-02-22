import { RequestContext } from "../shared/types.js";
import { AdapterResult } from "../adapters/stubAdapter.js";
import { runStubAdapter } from "../adapters/stubAdapter.js";
import { runCodexAdapter } from "../adapters/codexAdapter.js";

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

function resolveRouteForContext(context: RequestContext): RouteDecision {
  if (context.provider === "openai-codex") {
    return { route: "codex" };
  }
  return resolveRoute(context.input);
}

export async function runPipeline(context: RequestContext): Promise<{ adapter: AdapterResult }> {
  const decision = resolveRouteForContext(context);
  const adapter =
    decision.route === "codex"
      ? await runCodexAdapter(context, decision.route)
      : runStubAdapter(context, decision.route);
  return { adapter };
}
