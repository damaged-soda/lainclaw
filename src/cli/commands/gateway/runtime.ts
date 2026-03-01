import { runCommand } from '../../shared/result.js';
import { runGatewayConfigCommand, runGatewayStart, runGatewayStatusOrStop } from '../../../gateway/runtime/start.js';
import type { GatewayConfigParsedCommand, GatewayParsedCommand } from '../../../gateway/runtime/contracts.js';

type GatewayCommand = GatewayParsedCommand | GatewayConfigParsedCommand;

function isGatewayConfigCommand(parsed: GatewayCommand): parsed is GatewayConfigParsedCommand {
  return 'channelProvided' in parsed;
}

export async function runGatewayCommand(parsed: GatewayCommand): Promise<number> {
  return runCommand(async () => {
    if (isGatewayConfigCommand(parsed)) {
      return runGatewayConfigCommand(parsed);
    }
    if (parsed.action === 'status') {
      return runGatewayStatusOrStop(parsed, 'status');
    }
    if (parsed.action === 'stop') {
      return runGatewayStatusOrStop(parsed, 'stop');
    }
    return runGatewayStart(parsed);
  });
}
