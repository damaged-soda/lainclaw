import { feishuChannel } from '../../channels/feishu/index.js';
import { localChannel } from '../../channels/local/index.js';
import type { Channel, ChannelId } from '../../channels/contracts.js';
import type { GatewayChannel } from './contracts.js';

export const channelsRegistry: Record<ChannelId, Channel> = {
  feishu: feishuChannel,
  local: localChannel,
};

export const channelIds = Object.keys(channelsRegistry) as ChannelId[];

export const GatewayChannels: GatewayChannel[] = [...channelIds];

export function resolveGatewayChannel(rawChannel: string): GatewayChannel {
  const channel = rawChannel.trim().toLowerCase();
  if ((GatewayChannels as string[]).includes(channel)) {
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
