import { runGatewayStatusOrStop } from './runtime.js';
import { type GatewayParsedCommand } from './runtime.js';

export async function runGatewayStopCommand(parsed: GatewayParsedCommand): Promise<number> {
  return runGatewayStatusOrStop(parsed, "stop");
}
