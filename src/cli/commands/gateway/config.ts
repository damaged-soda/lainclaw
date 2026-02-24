import { runGatewayConfigCommand as runGatewayConfigCommandImpl } from './runtime.js';

export async function runGatewayConfigCommand(args: string[]): Promise<number> {
  return runGatewayConfigCommandImpl(args);
}
