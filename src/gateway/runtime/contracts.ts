import type { IntegrationId } from '../../integrations/contracts.js';

export type GatewayChannel = IntegrationId;

export interface GatewayStartOverrides {
  [key: string]: unknown;
}

export interface GatewayConfigParsedCommand {
  channel: string;
  channelProvided: boolean;
  action: 'set' | 'show' | 'clear' | 'migrate';
  dryRun?: boolean;
  config: Record<string, unknown>;
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
