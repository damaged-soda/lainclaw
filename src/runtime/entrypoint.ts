import path from "node:path";
import {
  resolveProvider,
  type ProviderRunInput,
  type ResolvedProvider,
} from "../providers/registry.js";
import type { ProviderResult } from "../providers/stubAdapter.js";

export interface RuntimeOptions {
  requestContext: ProviderRunInput["requestContext"];
  withTools: boolean;
  toolAllow: string[];
  cwd?: string;
  toolSpecs?: ProviderRunInput["toolSpecs"];
}

export interface RuntimeResult {
  adapter: ProviderResult;
}

export async function runRuntime(input: RuntimeOptions): Promise<RuntimeResult> {
  const requestContext = input.requestContext;
  const resolved: ResolvedProvider = resolveProvider(requestContext.provider);
  const route = `adapter.${resolved.provider}`;
  const providerInput: ProviderRunInput = {
    requestContext,
    route,
    withTools: input.withTools,
    toolAllow: input.toolAllow,
    ...(typeof input.cwd === "string" ? { cwd: path.resolve(input.cwd) } : {}),
    ...(Array.isArray(input.toolSpecs) ? { toolSpecs: input.toolSpecs } : {}),
  };

  const adapter = await resolved.run(providerInput);
  return { adapter };
}
