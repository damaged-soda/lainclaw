import { executeTool as executeToolInternal } from "./executor.js";
import { listTools as listToolsInternal, type ToolQueryOptions } from "./registry.js";
import { firstToolErrorFromLogs as firstToolErrorFromLogsInternal } from "./runtimeTools.js";
import type {
  CoreToolCall,
  CoreToolContext,
  CoreToolsPort,
  CoreToolSpec,
  CoreToolError,
  CoreToolExecutionLog,
} from "../core/contracts.js";
import { ValidationError } from "../shared/types.js";
import type {
  ToolCall,
  ToolContext,
  ToolError,
  ToolExecutionLog,
  ToolResult,
  ToolSpec,
} from "./types.js";

function toCoreToolSpec(spec: ToolSpec): CoreToolSpec {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
  };
}

function toToolCall(input: CoreToolCall): ToolCall {
  return {
    id: input.id,
    name: input.name,
    args: input.args,
    source: input.source,
  };
}

function toToolResult(input: ToolResult): ToolResult {
  return {
    ok: input.ok,
    ...(input.content ? { content: input.content } : {}),
    ...(input.data !== undefined ? { data: input.data } : {}),
    ...(input.meta ? { meta: input.meta } : {}),
    ...(input.error ? { error: input.error } : {}),
  };
}

function toToolLog(log: ToolExecutionLog): CoreToolExecutionLog {
  return {
    call: {
      id: log.call.id,
      name: log.call.name,
      ...(typeof log.call.args === "undefined" ? {} : { args: log.call.args }),
      ...(typeof log.call.source === "string" ? { source: log.call.source } : {}),
    },
    result: {
      ok: log.result.ok,
      ...(log.result.content ? { content: log.result.content } : {}),
      ...(log.result.data !== undefined ? { data: log.result.data } : {}),
      ...(log.result.error ? { error: log.result.error } : {}),
      ...(log.result.meta ? { meta: log.result.meta } : {}),
    },
  };
}

function toToolContext(context: CoreToolContext): ToolContext {
  return {
    requestId: context.requestId,
    sessionId: context.sessionId,
    sessionKey: context.sessionKey,
    cwd: context.cwd ?? process.cwd(),
    ...(context.signal ? { signal: context.signal } : {}),
  };
}

function isToolError(error: ToolError | undefined): error is CoreToolError {
  return !!error && typeof error.code === "string" && typeof error.tool === "string" && typeof error.message === "string";
}

function normalizeToolError(error: unknown): ValidationError {
  if (error instanceof ValidationError) {
    return error.code === "TOOL_FAILURE" || error.code === "INTERNAL_ERROR" || error.code === "VALIDATION_ERROR"
      ? error
      : new ValidationError(error.message, "TOOL_FAILURE");
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ValidationError(message || "tools adapter failed", "TOOL_FAILURE");
}

export function createToolsAdapter(): CoreToolsPort {
  return {
    listTools: (options?: ToolQueryOptions): CoreToolSpec[] => {
      try {
        return listToolsInternal(options).map(toCoreToolSpec);
      } catch (error) {
        throw normalizeToolError(error);
      }
    },
    executeTool: async (call: CoreToolCall, context: CoreToolContext): Promise<CoreToolExecutionLog> => {
      try {
        const executed: ToolExecutionLog = await executeToolInternal(
          toToolCall(call),
          toToolContext(context),
        );
        return toToolLog(executed);
      } catch (error) {
        throw normalizeToolError(error);
      }
    },
    firstToolErrorFromLogs: (logs: CoreToolExecutionLog[] | undefined): CoreToolError | undefined => {
      const runtimeLogs: ToolExecutionLog[] = Array.isArray(logs)
        ? logs.map((log): ToolExecutionLog => ({
          call: toToolCall(log.call),
          result: toToolResult(log.result),
        }))
        : [];

      const first = firstToolErrorFromLogsInternal(runtimeLogs);
      return isToolError(first) ? first : undefined;
    },
  };
}
