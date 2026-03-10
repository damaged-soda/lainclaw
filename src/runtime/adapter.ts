import { ValidationError } from "../shared/types.js";
import {
  buildRuntimeRequestContext,
} from "./context.js";
import {
  runRuntime,
  type RuntimeResult,
} from "./entrypoint.js";
import {
  type CoreContextToolSpec,
  type CoreRuntimeInput,
  type CoreRuntimeResult,
  type CoreRuntimePort,
  type CoreErrorCode,
} from "../core/contracts.js";

export interface RuntimeAdapterOptions {
  run?: (input: CoreRuntimeInput) => Promise<CoreRuntimeResult>;
  runRuntimeFn?: (input: {
    requestContext: ReturnType<typeof buildRuntimeRequestContext>["requestContext"];
    withTools: boolean;
    cwd?: string;
    toolSpecs?: CoreContextToolSpec[];
    onAgentEvent?: CoreRuntimeInput["onAgentEvent"];
  }) => Promise<RuntimeResult>;
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

  const runRuntimeFn = options.runRuntimeFn ?? runRuntime;

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
          debug: input.debug === true,
        });

        const { adapter: adapterResult } = await runRuntimeFn({
          requestContext: requestContext.requestContext,
          withTools: input.withTools,
          ...(typeof input.cwd === "string" ? { cwd: input.cwd } : {}),
          ...(Array.isArray(input.tools) ? { toolSpecs: toCoreContextTools(input.tools) } : {}),
          ...(input.onAgentEvent ? { onAgentEvent: input.onAgentEvent } : {}),
        });

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
