import { executeTool as executeToolInternal } from "./executor.js";
import { listTools as listToolsInternal } from "./registry.js";
import { firstToolErrorFromLogs as firstToolErrorFromLogsInternal } from "./runtimeTools.js";
import type { CoreToolsPort } from "../core/contracts.js";
import type { ContextToolSpec } from "../shared/types.js";
import { ValidationError } from "../shared/types.js";
import type { ToolError, ToolSpec } from "./types.js";

function toContextToolSpec(spec: ToolSpec): ContextToolSpec {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
  };
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
    listTools: (): ContextToolSpec[] => {
      try {
        return listToolsInternal().map(toContextToolSpec);
      } catch (error) {
        throw normalizeToolError(error);
      }
    },
    executeTool: async (call, context) => {
      try {
        return await executeToolInternal(call, context);
      } catch (error) {
        throw normalizeToolError(error);
      }
    },
    firstToolErrorFromLogs: (logs): ToolError | undefined => {
      return firstToolErrorFromLogsInternal(logs);
    },
  };
}
