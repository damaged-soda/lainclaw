import { runLocalTransport } from './transport.js';
import { handleInbound } from '../../gateway/handlers/handleInbound.js';
import {
  type Channel,
  type ChannelRunContext,
  type InboundMessage,
  type OutboundMessage,
} from '../contracts.js';

interface LocalGatewayOverrides {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  memory?: boolean;
  debug?: boolean;
}

function normalizeLocalOverrides(raw: unknown): LocalGatewayOverrides {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  return raw as LocalGatewayOverrides;
}

function buildRunInboundRuntime(overrides: LocalGatewayOverrides, context?: ChannelRunContext): {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  memory?: boolean;
  debug?: boolean;
} {
  return {
    provider: overrides.provider,
    profileId: overrides.profileId,
    withTools: overrides.withTools,
    memory: overrides.memory,
    ...(context?.debug === true ? { debug: true } : {}),
  };
}

async function runCoreInbound(
  inbound: InboundMessage,
  overrides: LocalGatewayOverrides,
  context?: ChannelRunContext,
): Promise<OutboundMessage | void> {
  return handleInbound(inbound, {
    runtime: buildRunInboundRuntime(overrides, context),
    policyConfig: {},
  });
}

export const localChannel: Channel = {
  id: 'local',
  preflight: async (overrides?: unknown): Promise<LocalGatewayOverrides> => {
    return normalizeLocalOverrides(overrides);
  },
  run: async (onInbound, overrides?: unknown, _context?: ChannelRunContext): Promise<void> => {
    const runtimeOverrides = normalizeLocalOverrides(overrides);

    await runLocalTransport(async (inbound): Promise<OutboundMessage | void> => {
      if (onInbound) {
        const overridden = await onInbound(inbound);
        if (overridden) {
          return overridden;
        }
      }
      return runCoreInbound(inbound, runtimeOverrides, _context);
    });
  },
};

export { resolveLocalGatewayPathsForTests } from './transport.js';
