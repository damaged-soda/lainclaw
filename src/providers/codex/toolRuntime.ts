import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ContextToolSpec, RequestContext } from "../../shared/types.js";
import { createToolCallId } from "../../shared/ids.js";
import {
  runLangfuseOperationSafely,
  startObservation,
} from "../../observability/langfuse.js";
import { executeTool } from "../../tools/executor.js";
import {
  buildRuntimeToolNameMap,
  createToolAdapter,
  resolveTools,
  type RuntimeToolNameMap,
} from "../../tools/runtimeTools.js";
import type { ToolCall, ToolExecutionLog } from "../../tools/types.js";

export interface CodexToolRuntime {
  toolSpecs: ContextToolSpec[];
  toolNameMap: RuntimeToolNameMap;
  agentTools: AgentTool<any>[];
}

export interface CreateCodexToolRuntimeInput {
  requestId: string;
  requestContext: Pick<RequestContext, "sessionId" | "sessionKey" | "profileId">;
  provider: string;
  cwd: string;
  toolSpecs: ContextToolSpec[] | undefined;
  withTools: boolean;
  tracingEnabled: boolean;
}

export interface CodexToolRuntimeDependencies {
  executeToolFn?: typeof executeTool;
}

function buildToolObservationOutput(log: ToolExecutionLog): unknown {
  return {
    ok: log.result.ok,
    ...(log.result.content !== undefined ? { content: log.result.content } : {}),
    ...(log.result.error ? { error: log.result.error } : {}),
    ...(log.result.meta ? { meta: log.result.meta } : {}),
  };
}

function buildToolErrorLog(toolCall: ToolCall, message: string): ToolExecutionLog {
  return {
    call: {
      ...toolCall,
      source: "agent-runtime",
    },
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

export function createCodexToolRuntime(
  input: CreateCodexToolRuntimeInput,
  dependencies: CodexToolRuntimeDependencies = {},
): CodexToolRuntime {
  const executeToolFn = dependencies.executeToolFn ?? executeTool;
  const toolSpecs = resolveTools(input.toolSpecs, input.withTools);
  const toolNameMap = buildRuntimeToolNameMap(toolSpecs);

  const runTool = async (toolCall: ToolCall, signal?: AbortSignal): Promise<ToolExecutionLog> => {
    const resolvedCall: ToolCall = {
      ...toolCall,
      id: toolCall.id || createToolCallId(toolCall.name || "unknown"),
      source: "agent-runtime",
    };

    const startedAt = Date.now();
    try {
      const execution = await executeToolFn(resolvedCall, {
        requestId: input.requestId,
        sessionId: input.requestContext.sessionId,
        sessionKey: input.requestContext.sessionKey,
        cwd: input.cwd,
        signal,
      });
      const log: ToolExecutionLog = {
        call: {
          ...execution.call,
          id: resolvedCall.id,
        },
        result: {
          ...execution.result,
          meta: {
            ...execution.result.meta,
            tool: resolvedCall.name,
            durationMs: Math.max(1, Date.now() - startedAt),
          },
        },
      };
      if (input.tracingEnabled) {
        runLangfuseOperationSafely(() => {
          const toolObservation = startObservation(
            `tool.${resolvedCall.name}`,
            {
              input: resolvedCall.args,
              output: buildToolObservationOutput(log),
              metadata: {
                requestId: input.requestId,
                sessionId: input.requestContext.sessionId,
                sessionKey: input.requestContext.sessionKey,
                provider: input.provider,
                profileId: input.requestContext.profileId,
                toolCallId: resolvedCall.id,
                toolName: resolvedCall.name,
              },
              ...(log.result.ok ? {} : {
                level: "ERROR" as const,
                statusMessage: log.result.error?.message ?? `tool ${resolvedCall.name} failed`,
              }),
            },
            { asType: "tool" },
          );
          toolObservation.end();
        }, `tool.${resolvedCall.name}`);
      }
      return log;
    } catch (error) {
      const log = buildToolErrorLog(
        resolvedCall,
        error instanceof Error ? error.message : "tool execution failed",
      );
      if (input.tracingEnabled) {
        runLangfuseOperationSafely(() => {
          const toolObservation = startObservation(
            `tool.${resolvedCall.name}`,
            {
              input: resolvedCall.args,
              output: buildToolObservationOutput(log),
              metadata: {
                requestId: input.requestId,
                sessionId: input.requestContext.sessionId,
                sessionKey: input.requestContext.sessionKey,
                provider: input.provider,
                profileId: input.requestContext.profileId,
                toolCallId: resolvedCall.id,
                toolName: resolvedCall.name,
              },
              level: "ERROR",
              statusMessage: log.result.error?.message ?? `tool ${resolvedCall.name} failed`,
            },
            { asType: "tool" },
          );
          toolObservation.end();
        }, `tool.${resolvedCall.name}`);
      }
      return log;
    }
  };

  return {
    toolSpecs,
    toolNameMap,
    agentTools: createToolAdapter(toolSpecs, runTool, toolNameMap),
  };
}
