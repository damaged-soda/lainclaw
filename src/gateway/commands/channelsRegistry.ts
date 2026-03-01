import { feishuChannel } from '../../channels/feishu/index.js';
import { localChannel } from '../../channels/local/index.js';
import type { Channel, ChannelId } from '../../channels/contracts.js';

export const channelsRegistry: Record<ChannelId, Channel> = {
  feishu: feishuChannel,
  local: localChannel,
};

export const channelIds = Object.keys(channelsRegistry) as ChannelId[];
