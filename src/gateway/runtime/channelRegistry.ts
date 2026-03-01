import { gatewayRuntimes } from './runtimes.js';

export type GatewayRuntimeChannel = keyof typeof gatewayRuntimes;
export type GatewayChannel = GatewayRuntimeChannel;

const GATEWAY_CHANNELS: GatewayChannel[] = Object.keys(gatewayRuntimes) as GatewayChannel[];

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
