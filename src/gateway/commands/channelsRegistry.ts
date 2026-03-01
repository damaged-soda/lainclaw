import { feishuIntegration } from '../../channels/feishu/index.js';
import { localIntegration } from '../../channels/local/index.js';
import type { Channel, ChannelId } from '../../channels/contracts.js';

export const channelsRegistry: Record<ChannelId, Channel> = {
  feishu: feishuIntegration,
  local: localIntegration,
};

export const channelIds = Object.keys(channelsRegistry) as ChannelId[];
