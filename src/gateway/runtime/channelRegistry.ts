import type { GatewayChannel } from './contracts.js';

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
