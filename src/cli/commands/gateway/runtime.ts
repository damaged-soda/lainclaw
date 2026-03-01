import { parseGatewayArgs } from '../../parsers/gateway.js';
import { printUsage } from '../../usage.js';
import { runCommand } from '../../shared/result.js';
import {
  runGatewayConfigCommand,
  runGatewayStart,
  runGatewayStatusOrStop,
} from '../../../gateway/runtime/start.js';

export async function runGatewayCommand(args: string[]): Promise<number> {
  return runCommand(async () => {
    const subcommand = args[0];

    if (args.some((arg) => arg === '--help' || arg === '-h')) {
      console.log(printUsage());
      return 0;
    }

    if (subcommand === 'config') {
      try {
        return await runGatewayConfigCommand(args.slice(1));
      } catch (error) {
        console.error(
          'ERROR:',
          String(error instanceof Error ? error.message : error),
        );
        printGatewayCommandUsage();
        return 1;
      }
    }

    try {
      const parsed = parseGatewayArgs(args);
      if (parsed.action === 'status') {
        return runGatewayStatusOrStop(parsed, 'status');
      }
      if (parsed.action === 'stop') {
        return runGatewayStatusOrStop(parsed, 'stop');
      }
      return runGatewayStart(parsed);
    } catch (error) {
      console.error(
        'ERROR:',
        String(error instanceof Error ? error.message : error),
      );
      printGatewayCommandUsage();
      return 1;
    }
  });
}

export function printGatewayCommandUsage(): void {
  console.error(
    'Usage:',
    '  lainclaw gateway start [--channel <feishu|local> ...] [--provider <provider>] [--profile <profile>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--memory|--no-memory] [--heartbeat-enabled|--no-heartbeat-enabled] [--heartbeat-interval-ms <ms>] [--heartbeat-target-open-id <openId>] [--heartbeat-session-key <key>] [--pairing-policy <open|allowlist|pairing|disabled>] [--pairing-allow-from <id1,id2>] [--pairing-pending-ttl-ms <ms>] [--pairing-pending-max <n>] [--app-id <id>] [--app-secret <secret>] [--request-timeout-ms <ms>] [--debug] [--daemon] [--pid-file <path>] [--log-file <path>]',
    '  lainclaw gateway status [--channel <channel>] [--pid-file <path>]',
    '  lainclaw gateway stop [--channel <channel>] [--pid-file <path>]',
    '  lainclaw gateway config set [--channel <channel>] [--provider <provider>] [--profile <profile>] [--app-id <id>] [--app-secret <secret>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--memory|--no-memory] [--heartbeat-enabled|--no-heartbeat-enabled] [--heartbeat-interval-ms <ms>] [--heartbeat-target-open-id <openId>] [--heartbeat-session-key <key>] [--pairing-policy <open|allowlist|pairing|disabled>] [--pairing-pending-ttl-ms <ms>] [--pairing-pending-max <n>] [--request-timeout-ms <ms>]',
    '  lainclaw gateway config show [--channel <channel>]',
    '  lainclaw gateway config clear [--channel <channel>]',
    '  lainclaw gateway config migrate [--channel <channel>] --dry-run',
  );
}
