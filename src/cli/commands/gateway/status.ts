import { runGatewayStatusOrStop } from './runtime.js';
import { type GatewayParsedCommand } from './runtime.js';

export async function runGatewayStatusCommand(parsed: GatewayParsedCommand): Promise<number> {
  return runGatewayStatusOrStop(parsed, "status");
}
