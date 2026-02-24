import type { ToolCall, ToolContext, ToolExecutionLog, ToolResult, ToolSpec } from "./types.js";
import { listTools, getTool } from "./registry.js";
import { executeTool } from "./executor.js";

type ToolCatalogEntry = Pick<ToolSpec, "name" | "description" | "inputSchema">;

export function listToolsCatalog(allowList?: string[]): ToolCatalogEntry[] {
  return listTools({ allowList }).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

export function getToolInfo(name: string, allowList?: string[]): ToolCatalogEntry | undefined {
  const tool = getTool(name, { allowList });
  if (!tool) {
    return undefined;
  }
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}

export async function invokeToolByCli(
  name: string,
  args: unknown,
  context: ToolContext,
): Promise<ToolExecutionLog> {
  return executeTool(
    {
      id: `cli-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`,
      name,
      args,
      source: "cli",
    },
    context,
  );
}

export async function invokeToolsForAgent(
  calls: ToolCall[],
  context: ToolContext,
): Promise<ToolExecutionLog[]> {
  const results: ToolExecutionLog[] = [];

  for (const call of calls) {
    results.push(await executeTool(call, context));
  }

  return results;
}

export function getToolResultsPayload(executions: ToolExecutionLog[]): ToolResult[] {
  return executions.map((execution) => execution.result);
}
