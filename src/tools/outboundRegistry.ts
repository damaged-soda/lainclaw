import type { ChannelId, ChannelSendText } from "../channels/contracts.js";

const registry = new Map<ChannelId, ChannelSendText>();

function normalizeChannel(rawChannel: string): ChannelId | undefined {
  const channel = rawChannel.trim().toLowerCase();
  if (channel === "feishu" || channel === "local") {
    return channel;
  }
  return undefined;
}

export function registerOutboundChannel(channel: ChannelId, sendText: ChannelSendText): void {
  registry.set(channel, sendText);
}

export function clearOutboundChannels(): void {
  registry.clear();
}

export function hasOutboundChannel(channel: string): boolean {
  const normalized = normalizeChannel(channel);
  return normalized ? registry.has(normalized) : false;
}

export async function sendOutboundMessage(
  channel: string,
  to: string,
  text: string,
): Promise<void> {
  const normalized = normalizeChannel(channel);
  if (!normalized) {
    throw new Error(`unsupported outbound channel: ${channel}`);
  }

  const sender = registry.get(normalized);
  if (!sender) {
    throw new Error(`outbound channel not available: ${normalized}`);
  }

  await sender(to, text);
}
