import type { ChannelId } from '../../channels/contracts.js';
import type { GatewayRuntimeConfig } from '../runtimeConfig.js';

export type GatewayChannel = ChannelId;

export interface GatewayStartOverrides {
  channelConfig?: Record<string, unknown>;
  runtimeConfig?: GatewayRuntimeConfig;
}

export interface GatewayConfigParsedCommand {
  channel: string;
  channelProvided: boolean;
  action: 'set' | 'show' | 'clear';
  config: GatewayStartOverrides;
}

export interface GatewayParsedCommand {
  channel: GatewayChannel;
  channels: GatewayChannel[];
  action: 'start' | 'status' | 'stop';
  debug?: boolean;
  daemon?: boolean;
  statePath?: string;
  logPath?: string;
  serviceChild?: boolean;
  serviceArgv: string[];
  config?: GatewayStartOverrides;
}

export interface GatewayServiceRunContext {
  channel: GatewayChannel | 'gateway';
  action?: 'start' | 'status' | 'stop';
  daemon?: boolean;
  statePath?: string;
  logPath?: string;
  serviceChild?: boolean;
  serviceArgv: string[];
  channels?: GatewayChannel[];
  debug?: boolean;
}
