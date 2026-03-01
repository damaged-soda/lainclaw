import { parseFeishuServerArgs } from './gateway.js';
import type { GatewayConfigParsedCommand } from '../../gateway/runtime/contracts.js';
import type { FeishuGatewayConfig } from '../../channels/feishu/config.js';

export function parseGatewayConfigArgs(argv: string[]): GatewayConfigParsedCommand {
  const subcommand = argv[0];
  if (!subcommand) {
    throw new Error('Missing gateway config subcommand');
  }

  let channel = 'default';
  let channelProvided = false;
  const configArgv: string[] = [];

  if (subcommand === 'set') {
    for (let i = 1; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === '--channel') {
        if (i + 1 >= argv.length) {
          throw new Error('Invalid value for --channel');
        }
        channel = argv[i + 1].trim().toLowerCase();
        channelProvided = true;
        i += 1;
        continue;
      }
      if (arg.startsWith('--channel=')) {
        channel = arg.slice('--channel='.length).trim().toLowerCase();
        if (!channel) {
          throw new Error('Invalid value for --channel');
        }
        channelProvided = true;
        continue;
      }
      if (arg.startsWith('--')) {
        configArgv.push(arg);
        continue;
      }
      configArgv.push(arg);
    }

    const config = parseFeishuServerArgs(configArgv);
    if (Object.keys(config).length === 0) {
      throw new Error('No gateway config fields provided');
    }
    if (
      (channel === 'default' || !channelProvided)
      && (typeof config.appId === 'string' || typeof config.appSecret === 'string')
    ) {
      throw new Error('appId/appSecret must be scoped with --channel, e.g. --channel feishu');
    }
    if (channel !== 'default' && typeof config.provider === 'string') {
      throw new Error('provider is a gateway-level field and cannot be set with --channel; set it at default scope');
    }
    return { channel, channelProvided, action: 'set', config };
  }

  if (subcommand === 'show' || subcommand === 'clear') {
    for (let i = 1; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === '--channel') {
        if (i + 1 >= argv.length) {
          throw new Error('Invalid value for --channel');
        }
        channel = argv[i + 1].trim().toLowerCase();
        channelProvided = true;
        i += 1;
        continue;
      }
      if (arg.startsWith('--channel=')) {
        channel = arg.slice('--channel='.length).trim().toLowerCase();
        if (!channel) {
          throw new Error('Invalid value for --channel');
        }
        channelProvided = true;
        continue;
      }
      if (arg.startsWith('--')) {
        throw new Error(`Unknown option for gateway config ${subcommand}: ${arg}`);
      }
      throw new Error(`Unexpected argument for gateway config ${subcommand}: ${arg}`);
    }
    return { channel, channelProvided, action: subcommand, config: {} };
  }

  if (subcommand === 'migrate') {
    let dryRun = false;
    for (let i = 1; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === '--channel') {
        if (i + 1 >= argv.length) {
          throw new Error('Invalid value for --channel');
        }
        channel = argv[i + 1].trim().toLowerCase();
        if (!channel) {
          throw new Error('Invalid value for --channel');
        }
        channelProvided = true;
        i += 1;
        continue;
      }
      if (arg.startsWith('--channel=')) {
        channel = arg.slice('--channel='.length).trim().toLowerCase();
        if (!channel) {
          throw new Error('Invalid value for --channel');
        }
        channelProvided = true;
        continue;
      }
      if (arg === '--dry-run') {
        dryRun = true;
        continue;
      }
      if (arg.startsWith('--')) {
        throw new Error(`Unknown option for gateway config ${subcommand}: ${arg}`);
      }
      throw new Error(`Unexpected argument for gateway config ${subcommand}: ${arg}`);
    }
    if (!dryRun) {
      throw new Error('gateway config migrate currently only supports --dry-run');
    }
    return { channel, channelProvided, action: 'migrate', dryRun, config: {} };
  }

  throw new Error(`Unknown gateway config subcommand: ${subcommand}`);
}
