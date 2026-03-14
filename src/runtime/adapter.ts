import path from "node:path";
import { ValidationError } from "../shared/types.js";
import {
  resolveProvider,
  type ProviderResult,
  type ProviderRunInput,
} from "../providers/registry.js";
import { type CoreErrorCode, type CoreRuntimePort } from "../core/contracts.js";

export interface RuntimeAdapterOptions {
  run?: (input: ProviderRunInput) => Promise<ProviderResult>;
  resolveProviderFn?: typeof resolveProvider;
}

export function createRuntimeAdapter(options: RuntimeAdapterOptions = {}): CoreRuntimePort {
  if (options.run) {
    return {
      run: options.run,
    };
  }

  const resolveProviderFn = options.resolveProviderFn ?? resolveProvider;

  return {
    run: async (input: ProviderRunInput): Promise<ProviderResult> => {
      try {
        const resolved = resolveProviderFn(input.requestContext.provider);
        const requestContext = input.requestContext.provider === resolved.provider
          ? input.requestContext
          : {
            ...input.requestContext,
            provider: resolved.provider,
          };
        return await resolved.run({
          ...input,
          requestContext,
          ...(typeof input.cwd === "string" ? { cwd: path.resolve(input.cwd) } : {}),
        });
      } catch (error) {
        if (error instanceof ValidationError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        const lower = message.toLowerCase();
        const code: CoreErrorCode = lower.includes("missing provider") || lower.includes("no provider")
          ? "MISSING_PROVIDER"
          : "RUNTIME_FAILURE";
        throw new ValidationError(message || "runtime adapter failed", code);
      }
    },
  };
}
