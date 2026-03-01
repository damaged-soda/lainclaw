import { channelIds } from './channelsRegistry.js';
import type { GatewayChannel } from './contracts.js';

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
