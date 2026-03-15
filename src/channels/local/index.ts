import { runLocalTransport } from './transport.js';
import {
  type Channel,
  type ChannelPreflightInput,
  type ChannelRunInput,
} from '../contracts.js';

export const localChannel: Channel = {
  id: 'local',
  preflight: async (_input?: ChannelPreflightInput): Promise<Record<string, never>> => {
    return {};
  },
  run: async (input: ChannelRunInput): Promise<void> => {
    await runLocalTransport(input.onInbound);
  },
};
