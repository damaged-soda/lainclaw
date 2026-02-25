import path from "node:path";
import { resolveAdapter, type AdapterRunInput, type ResolvedAdapter } from "../adapters/registry.js";
import type { AdapterResult } from "../adapters/stubAdapter.js";

interface RuntimeOptions {
  requestContext: AdapterRunInput["requestContext"];
  withTools: boolean;
  toolAllow: string[];
  cwd?: string;
  toolSpecs?: AdapterRunInput["toolSpecs"];
}

interface RuntimeResult {
  adapter: AdapterResult;
}

export async function runRuntime(input: RuntimeOptions): Promise<RuntimeResult> {
  const requestContext = input.requestContext;
  const resolved: ResolvedAdapter = resolveAdapter(requestContext.provider);
  const route = `adapter.${resolved.provider}`;
  const toolAllow = Array.isArray(input.toolAllow) ? input.toolAllow : [];
  const withTools = typeof input.withTools === "boolean" ? input.withTools : true;
  const adapterInput: AdapterRunInput = {
    requestContext,
    route,
    withTools,
    toolAllow,
    ...(typeof input.cwd === "string" ? { cwd: path.resolve(input.cwd) } : {}),
    ...(Array.isArray(input.toolSpecs) ? { toolSpecs: input.toolSpecs } : {}),
  };

  const adapter = await resolved.run(adapterInput);
  return { adapter };
}
