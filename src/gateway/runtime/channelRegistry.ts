import { parseFeishuServerArgs, parseLocalGatewayArgs } from '../../cli/parsers/gateway.js';
import { makeFeishuFailureHint } from '../../channels/feishu/diagnostics.js';
import type { FeishuGatewayConfig } from '../../channels/feishu/config.js';
import type { LocalGatewayOverrides } from '../../channels/local/server.js';

export type GatewayChannel = 'feishu' | 'local';

export type GatewayStartOverrides = Partial<FeishuGatewayConfig> & Partial<LocalGatewayOverrides>;

type GatewayServiceChannel = GatewayChannel | 'gateway';
type GatewayAction = 'start' | 'status' | 'stop';

export interface GatewayServiceRunContext {
  channel: GatewayServiceChannel;
  action?: GatewayAction;
  daemon?: boolean;
  statePath?: string;
  logPath?: string;
  serviceChild?: boolean;
  serviceArgv: string[];
  channels?: GatewayChannel[];
  debug?: boolean;
}

export interface GatewayChannelPlugin {
  name: GatewayChannel;
  parseStartArgs: (argv: string[]) => GatewayStartOverrides;
  run: (overrides: GatewayStartOverrides, context: GatewayServiceRunContext) => Promise<void>;
}

export const GATEWAY_CHANNEL_PLUGINS: Record<GatewayChannel, GatewayChannelPlugin> = {
  feishu: {
    name: 'feishu',
    parseStartArgs: parseFeishuServerArgs,
    run: async (overrides, context) => {
      const runtime = await import('../../cli/commands/gateway/runtime.js');
      await runtime.runFeishuGatewayWithHeartbeat(overrides, makeFeishuFailureHint, context);
    },
  },
  local: {
    name: 'local',
    parseStartArgs: parseLocalGatewayArgs,
    run: async (overrides, context) => {
      const runtime = await import('../../cli/commands/gateway/runtime.js');
      await runtime.runLocalGatewayService(overrides, context);
    },
  },
};

export function resolveGatewayChannelPlugin(rawChannel: string): GatewayChannelPlugin {
  const channel = rawChannel.trim().toLowerCase();
  const plugin = GATEWAY_CHANNEL_PLUGINS[channel as GatewayChannel];
  if (!plugin) {
    throw new Error(`Unsupported channel: ${rawChannel}`);
  }
  return plugin;
}

export function normalizeGatewayChannels(rawChannels: GatewayChannel[]): GatewayChannel[] {
  const output: GatewayChannel[] = [];
  for (const channel of rawChannels) {
    if (!output.includes(channel)) {
      output.push(channel);
    }
  }
  return output;
}
