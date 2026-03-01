import { chooseFirstToolError } from "../../tools/runtimeTools.js";
import type { ToolCall, ToolExecutionLog, ToolError } from "../../tools/types.js";

export interface ToolExecutionState {
  toolCalls: ToolCall[];
  toolResults: ToolExecutionLog[];
  readonly toolError: ToolError | undefined;
  record(log: ToolExecutionLog): void;
}

export function buildToolErrorLog(toolCall: ToolCall, message: string): ToolExecutionLog {
  return {
    call: { ...toolCall, source: "agent-runtime" },
    result: {
      ok: false,
      error: {
        code: "execution_error",
        tool: toolCall.name,
        message,
      },
      meta: {
        tool: toolCall.name,
        durationMs: 0,
      },
    },
  };
}

export function createToolExecutionState(): ToolExecutionState {
  const toolCalls: ToolCall[] = [];
  const toolResults: ToolExecutionLog[] = [];
  const toolResultIndexById = new Map<string, number>();
  const toolLogById = new Map<string, ToolExecutionLog>();
  let toolError: ToolError | undefined;

  return {
    toolCalls,
    toolResults,
    get toolError() {
      return toolError;
    },
    record(log: ToolExecutionLog): void {
      const previousLog = toolLogById.get(log.call.id);
      const mergedLog = previousLog ? { ...previousLog, ...log, call: log.call } : log;
      const existingIndex = toolResultIndexById.get(log.call.id);

      if (existingIndex === undefined) {
        toolResultIndexById.set(log.call.id, toolResults.length);
        toolCalls.push(mergedLog.call);
        toolResults.push(mergedLog);
      } else {
        toolResults[existingIndex] = mergedLog;
      }

      toolLogById.set(log.call.id, mergedLog);

      if (log.result.error) {
        toolError = chooseFirstToolError(toolError, log.result.error);
      }
    },
  };
}
