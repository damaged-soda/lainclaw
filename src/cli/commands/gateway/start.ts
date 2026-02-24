import { runGatewayStart } from './runtime.js';
import { type GatewayParsedCommand } from './runtime.js';

export async function runGatewayStartCommand(parsed: GatewayParsedCommand): Promise<number> {
  return runGatewayStart(parsed);
}
