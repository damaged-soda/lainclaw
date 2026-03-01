import { runCommand } from '../shared/result.js';
import { executeTool } from '../../tools/executor.js';
import { getTool, listTools } from '../../tools/registry.js';
import type { ToolCall, ToolContext } from '../../tools/types.js';

export type ToolsCommandInput =
  | { kind: 'missing' }
  | { kind: 'unknown'; subcommand: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'list' }
  | { kind: 'info'; name: string }
  | { kind: 'invoke'; name: string; rawArgs?: string };

export async function runToolsCommand(parsed: ToolsCommandInput): Promise<number> {
  return runCommand(async () => {
    if (parsed.kind === 'missing') {
      console.error('Usage: lainclaw tools <list|info|invoke>');
      return 1;
    }
    if (parsed.kind === 'unknown') {
      console.error(`Unknown tools subcommand: ${parsed.subcommand}`);
      console.error('Usage: lainclaw tools <list|info|invoke>');
      return 1;
    }
    if (parsed.kind === 'invalid') {
      console.error(parsed.message);
      return 1;
    }
    if (parsed.kind === 'list') {
      const tools = listTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
      console.log(JSON.stringify(tools, null, 2));
      return 0;
    }
    if (parsed.kind === 'info') {
      const tool = getTool(parsed.name);
      if (!tool) {
        console.error(`Tool not found: ${parsed.name}`);
        return 1;
      }
      console.log(
        JSON.stringify(
          {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          },
          null,
          2,
        ),
      );
      return 0;
    }
    if (parsed.kind === 'invoke') {
      let parsedArgs: unknown = {};
      if (typeof parsed.rawArgs === 'string' && parsed.rawArgs.length > 0) {
        try {
          parsedArgs = JSON.parse(parsed.rawArgs);
        } catch (error) {
          console.error(`Invalid --args json: ${error instanceof Error ? error.message : String(error)}`);
          return 1;
        }
      }

      const call: ToolCall = {
        id: `cli-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, '0')}`,
        name: parsed.name,
        args: parsedArgs,
        source: 'cli',
      };
      const context: ToolContext = {
        requestId: `cli-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, '0')}`,
        sessionId: 'tools-cli',
        sessionKey: 'tools',
        cwd: process.cwd(),
      };
      const execResult = await executeTool(call, context);
      console.log(JSON.stringify(execResult, null, 2));
      return execResult.result.ok ? 0 : 1;
    }
    return 1;
  });
}
