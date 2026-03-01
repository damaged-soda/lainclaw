export type GatewayChannel = 'feishu' | 'local';

import type { FeishuGatewayConfig } from '../../channels/feishu/config.js';
import type { LocalGatewayOverrides } from '../../channels/local/server.js';

export type GatewayStartOverrides = Partial<FeishuGatewayConfig> & Partial<LocalGatewayOverrides>;

type GatewayServiceChannel = GatewayChannel | 'gateway';

export interface GatewayServiceRunContext {
  channel: GatewayServiceChannel;
  action?: 'start' | 'status' | 'stop';
  daemon?: boolean;
  statePath?: string;
  logPath?: string;
  serviceChild?: boolean;
  serviceArgv: string[];
  channels?: GatewayChannel[];
  debug?: boolean;
}

const GATEWAY_CHANNELS: GatewayChannel[] = ['feishu', 'local'];

export function resolveGatewayChannel(rawChannel: string): GatewayChannel {
  const channel = rawChannel.trim().toLowerCase();
  if (GATEWAY_CHANNELS.includes(channel as GatewayChannel)) {
    return channel as GatewayChannel;
  }
  throw new Error(`Unsupported channel: ${rawChannel}`);
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
