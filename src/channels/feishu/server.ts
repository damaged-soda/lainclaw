import { runFeishuTransport } from "../../transports/feishu/transport.js";
import {
  resolveFeishuGatewayConfig,
  type FeishuGatewayConfig,
  persistFeishuGatewayConfig,
} from "./config.js";
import { handleInbound } from "../../gateway/core/handleInbound.js";
import type { InboundMessage } from "../../transports/contracts.js";

export type FeishuFailureHintResolver = (rawMessage: string) => string;

interface FeishuGatewayServerOptions {
  onFailureHint?: FeishuFailureHintResolver;
}

const DEFAULT_AGENT_TIMEOUT_MS = 10000;

export async function runFeishuGatewayServer(
  overrides: Partial<FeishuGatewayConfig> = {},
  options: FeishuGatewayServerOptions = {},
  channel = "feishu",
): Promise<void> {
  const config = await resolveFeishuGatewayConfig(overrides, channel);
  await persistFeishuGatewayConfig(overrides, channel);

  const runAgentDefaults = {
    provider: config.provider,
    profileId: config.profileId,
    withTools: config.withTools,
    toolAllow: config.toolAllow,
    memory: config.memory,
  };

  await runFeishuTransport({
    config,
    onInbound: (inbound: InboundMessage) => {
      return handleInbound(inbound, {
        channel: "feishu",
        runtime: runAgentDefaults,
        config,
        timeoutMs: config.requestTimeoutMs || DEFAULT_AGENT_TIMEOUT_MS,
        onFailureHint: options.onFailureHint ?? ((raw) => raw),
      });
    },
  });
}

export { runAgent } from "../../gateway/index.js";
