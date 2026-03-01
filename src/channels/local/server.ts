import { handleInbound } from "../../gateway/core/handleInbound.js";
import { runLocalTransport } from "../../transports/local/transport.js";
import type { InboundMessage } from "../../transports/contracts.js";

export interface LocalGatewayOverrides {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  memory?: boolean;
  toolAllow?: string[];
}

interface LocalGatewayServerOptions {
  debug?: boolean;
}

export async function runLocalGatewayServer(
  overrides: Partial<LocalGatewayOverrides> = {},
  context: LocalGatewayServerOptions = {},
): Promise<void> {
  const runAgentDefaults = {
    provider: overrides.provider,
    profileId: overrides.profileId,
    withTools: overrides.withTools,
    memory: overrides.memory,
    toolAllow: overrides.toolAllow,
  };

  await runLocalTransport((inbound: InboundMessage) => {
    return handleInbound(inbound, {
      channel: "local",
      runtime: runAgentDefaults,
      timeoutMs: undefined,
      onFailureHint: (raw) => raw,
    });
  });

  const _debug = context.debug === true;
  void _debug;
}

export { resolveLocalGatewayPathsForTests } from "../../transports/local/transport.js";
