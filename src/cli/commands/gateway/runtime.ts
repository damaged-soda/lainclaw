import { printCommandUsage, printSubcommandUsage } from '../../usage.js';
import { parseGatewayArgs } from '../../parsers/gateway.js';
import { parseGatewayConfigArgs } from '../../parsers/gatewayConfig.js';
import { runCommand } from '../../shared/result.js';
import {
  runGatewayConfigCommand,
  runGatewayStart,
  runGatewayStatusOrStop,
} from '../../../gateway/runtime/start.js';

function renderGatewayError(error: unknown, args: string[]): void {
  console.error(
    'ERROR:',
    String(error instanceof Error ? error.message : error),
  );

  const configAction = args[0] === 'config' ? args[1] : undefined;
  if (configAction === 'set') {
    console.error(printSubcommandUsage('gateway', 'config set'));
    return;
  }
  if (configAction === 'show') {
    console.error(printSubcommandUsage('gateway', 'config show'));
    return;
  }
  if (configAction === 'clear') {
    console.error(printSubcommandUsage('gateway', 'config clear'));
    return;
  }
  if (configAction === 'migrate') {
    console.error(printSubcommandUsage('gateway', 'config migrate'));
    return;
  }

  console.error(printCommandUsage('gateway'));
}

export async function runGatewayCommand(args: string[]): Promise<number> {
  return runCommand(
    async () => {
      const subcommand = args[0];
      if (subcommand === 'config') {
        const parsed = parseGatewayConfigArgs(args.slice(1));
        return await runGatewayConfigCommand(parsed);
      }

      const parsed = parseGatewayArgs(args);
      if (parsed.action === 'status') {
        return runGatewayStatusOrStop(parsed, 'status');
      }
      if (parsed.action === 'stop') {
        return runGatewayStatusOrStop(parsed, 'stop');
      }
      return runGatewayStart(parsed);
    },
    {
      renderError: (error) => {
        renderGatewayError(error, args);
      },
    },
  );
}
