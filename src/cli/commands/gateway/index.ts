import { printUsage } from '../../usage.js';
import { parseGatewayArgs } from '../../parsers/gateway.js';
import { runGatewayConfigCommand } from './config.js';
import { runGatewayStartCommand } from './start.js';
import { runGatewayStatusCommand } from './status.js';
import { runGatewayStopCommand } from './stop.js';

export async function runGatewayCommand(args: string[]): Promise<number> {
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
        "ERROR:",
        String(error instanceof Error ? error.message : error),
      );
      console.error(
        "Usage:",
        "  lainclaw gateway start [--channel <feishu|local> ...] [--provider <provider>] [--profile <profile>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--tool-max-steps <N>] [--memory|--no-memory] [--heartbeat-enabled|--no-heartbeat-enabled] [--heartbeat-interval-ms <ms>] [--heartbeat-target-open-id <openId>] [--heartbeat-session-key <key>] [--pairing-policy <open|allowlist|pairing|disabled>] [--pairing-allow-from <id1,id2>] [--pairing-pending-ttl-ms <ms>] [--pairing-pending-max <n>] [--app-id <id>] [--app-secret <secret>] [--request-timeout-ms <ms>] [--debug] [--daemon] [--pid-file <path>] [--log-file <path>]",
        "  lainclaw gateway status [--channel <channel>] [--pid-file <path>]",
        "  lainclaw gateway stop [--channel <channel>] [--pid-file <path>]",
        "  lainclaw gateway config set [--channel <channel>] [--provider <provider>] [--profile <profile>] [--app-id <id>] [--app-secret <secret>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--tool-max-steps <N>] [--memory|--no-memory] [--heartbeat-enabled|--no-heartbeat-enabled] [--heartbeat-interval-ms <ms>] [--heartbeat-target-open-id <openId>] [--heartbeat-session-key <key>] [--pairing-policy <open|allowlist|pairing|disabled>] [--pairing-pending-ttl-ms <ms>] [--pairing-pending-max <n>] [--request-timeout-ms <ms>]",
        "  lainclaw gateway config show [--channel <channel>]",
        "  lainclaw gateway config clear [--channel <channel>]",
        "  lainclaw gateway config migrate [--channel <channel>] --dry-run",
      );
      return 1;
    }
  }

  try {
    const parsed = parseGatewayArgs(args);
    if (parsed.action === "status") {
      return runGatewayStatusCommand(parsed);
    }
    if (parsed.action === "stop") {
      return runGatewayStopCommand(parsed);
    }
    return runGatewayStartCommand(parsed);
  } catch (error) {
    console.error(
      "ERROR:",
      String(error instanceof Error ? error.message : error),
    );
    console.error(
      "Usage:",
      "  lainclaw gateway start [--channel <feishu|local> ...] [--provider <provider>] [--profile <profile>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--tool-max-steps <N>] [--memory|--no-memory] [--heartbeat-enabled|--no-heartbeat-enabled] [--heartbeat-interval-ms <ms>] [--heartbeat-target-open-id <openId>] [--heartbeat-session-key <key>] [--pairing-policy <open|allowlist|pairing|disabled>] [--pairing-allow-from <id1,id2>] [--pairing-pending-ttl-ms <ms>] [--pairing-pending-max <n>] [--app-id <id>] [--app-secret <secret>] [--request-timeout-ms <ms>] [--debug] [--daemon] [--pid-file <path>] [--log-file <path>]",
      "  lainclaw gateway status [--channel <channel>] [--pid-file <path>]",
      "  lainclaw gateway stop [--channel <channel>] [--pid-file <path>]",
      "  lainclaw gateway config set [--channel <channel>] [--provider <provider>] [--profile <profile>] [--app-id <id>] [--app-secret <secret>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--tool-max-steps <N>] [--memory|--no-memory] [--heartbeat-enabled|--no-heartbeat-enabled] [--heartbeat-interval-ms <ms>] [--heartbeat-target-open-id <openId>] [--heartbeat-session-key <key>] [--pairing-policy <open|allowlist|pairing|disabled>] [--pairing-pending-ttl-ms <ms>] [--pairing-pending-max <n>] [--request-timeout-ms <ms>]",
      "  lainclaw gateway config show [--channel <channel>]",
      "  lainclaw gateway config clear [--channel <channel>]",
      "  lainclaw gateway config migrate [--channel <channel>] --dry-run",
    );
    return 1;
  }
}
