import { parseToolsArgs, type ParsedToolsCommand } from '../parsers/tools.js';
import { getToolInfo, invokeToolByCli, listToolsCatalog } from '../../tools/gateway.js';
import { runCommand } from '../shared/result.js';

export async function runToolsCommand(args: string[]): Promise<number> {
  return runCommand(async () => {
    const parsed: ParsedToolsCommand = parseToolsArgs(args);

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
      console.log(JSON.stringify(listToolsCatalog(), null, 2));
      return 0;
    }
    if (parsed.kind === 'info') {
      const tool = getToolInfo(parsed.name);
      if (!tool) {
        console.error(`Tool not found: ${parsed.name}`);
        return 1;
      }
      console.log(JSON.stringify(tool, null, 2));
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
      const execResult = await invokeToolByCli(parsed.name, parsedArgs, {
        requestId: `cli-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, '0')}`,
        sessionId: 'tools-cli',
        sessionKey: 'tools',
        cwd: process.cwd(),
      });
      console.log(JSON.stringify(execResult, null, 2));
      return execResult.result.ok ? 0 : 1;
    }
    return 1;
  });
}
