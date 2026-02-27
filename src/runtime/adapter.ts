import path from "node:path";
import { resolveAdapter } from "../adapters/registry.js";
import { ValidationError } from "../shared/types.js";
import {
  buildRuntimeRequestContext,
} from "./context.js";
import {
  type CoreContextToolSpec,
  type CoreRuntimeInput,
  type CoreRuntimeResult,
  type CoreRuntimePort,
  type CoreErrorCode,
} from "../core/contracts.js";

export interface RuntimeAdapterOptions {
  run?: (input: CoreRuntimeInput) => Promise<CoreRuntimeResult>;
}

function toCoreContextTools(rawTools: CoreContextToolSpec[] | undefined): CoreContextToolSpec[] {
  if (!Array.isArray(rawTools)) {
    return [];
  }
  return rawTools;
}

export function createRuntimeAdapter(options: RuntimeAdapterOptions = {}): CoreRuntimePort {
  if (options.run) {
    return {
      run: options.run,
    };
  }

  return {
    run: async (input: CoreRuntimeInput): Promise<CoreRuntimeResult> => {
      try {
        const requestContext = buildRuntimeRequestContext({
          requestId: input.requestId,
          createdAt: input.createdAt,
          input: input.input,
          sessionKey: input.sessionKey,
          sessionId: input.sessionId,
          priorMessages: input.priorMessages,
          memorySnippet: input.memorySnippet,
          provider: input.provider,
          profileId: input.profileId,
          withTools: input.withTools,
          tools: toCoreContextTools(input.tools),
          systemPrompt: input.systemPrompt,
          memoryEnabled: input.memoryEnabled ?? true,
        });

        const resolved = resolveAdapter(input.provider);
        const route = `adapter.${resolved.provider}`;
        const toolAllow = input.toolAllow;
        const withTools = input.withTools;

        const adapterInput = {
          requestContext: requestContext.requestContext,
          route,
          withTools,
          toolAllow,
          ...(typeof input.cwd === "string" ? { cwd: path.resolve(input.cwd) } : {}),
          ...(Array.isArray(input.tools) ? { toolSpecs: toCoreContextTools(input.tools) } : {}),
        };

        const adapterResult = await resolved.run(adapterInput);

        return {
          route: adapterResult.route,
          stage: adapterResult.stage,
          result: adapterResult.result,
          ...(adapterResult.toolCalls ? { toolCalls: adapterResult.toolCalls } : {}),
          ...(adapterResult.toolResults ? { toolResults: adapterResult.toolResults } : {}),
          ...(adapterResult.assistantMessage ? { assistantMessage: adapterResult.assistantMessage } : {}),
          ...(adapterResult.stopReason ? { stopReason: adapterResult.stopReason } : {}),
          provider: adapterResult.provider,
          profileId: adapterResult.profileId,
        };
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
