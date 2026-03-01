import type { FeishuGatewayConfig } from '../../channels/feishu/config.js';
import type { LocalGatewayOverrides } from '../../channels/local/server.js';
import type { GatewayRuntimeChannel } from './channelRegistry.js';

export type GatewayChannel = GatewayRuntimeChannel;

export type GatewayFeishuStartOverrides = Partial<FeishuGatewayConfig>;
export type GatewayLocalStartOverrides = Partial<LocalGatewayOverrides>;
export type GatewayStartOverrides = GatewayFeishuStartOverrides | GatewayLocalStartOverrides;

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

interface GatewayParsedCommandBase {
  channel: GatewayChannel;
  channels: GatewayChannel[];
  action: 'start' | 'status' | 'stop';
  daemon?: boolean;
  statePath?: string;
  logPath?: string;
  serviceChild?: boolean;
  debug?: boolean;
  serviceArgv: string[];
}

export type GatewayParsedCommand = GatewayParsedCommandBase & GatewayStartOverrides;

export interface GatewayConfigParsedCommand {
  channel: string;
  channelProvided: boolean;
  action: 'set' | 'show' | 'clear' | 'migrate';
  dryRun?: boolean;
  config: Partial<FeishuGatewayConfig>;
}
