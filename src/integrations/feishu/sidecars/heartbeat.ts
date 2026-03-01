import { startHeartbeatSidecar } from '../../../gateway/runtime/sidecars/heartbeat.js';
import type { FeishuGatewayConfig } from '../config.js';
import type { HeartbeatLoopHandle } from '../../../heartbeat/runner.js';
import type { IntegrationOutboundTextCapability } from '../../../integrations/contracts.js';

interface StartFeishuHeartbeatSidecarInput {
  config: FeishuGatewayConfig;
  outbound?: IntegrationOutboundTextCapability;
  onFailureHint?: (rawMessage: string) => string;
}

export function startFeishuHeartbeatSidecar(
  input: StartFeishuHeartbeatSidecarInput,
): HeartbeatLoopHandle | undefined {
  const { config } = input;
  if (!config.heartbeatEnabled) {
    return undefined;
  }

  return startHeartbeatSidecar({
    outbound: input.outbound,
    enabled: config.heartbeatEnabled,
    provider: config.provider,
    ...(typeof config.profileId === 'string' && config.profileId.trim() ? { profileId: config.profileId.trim() } : {}),
    withTools: config.withTools,
    ...(Array.isArray(config.toolAllow) ? { toolAllow: config.toolAllow } : {}),
    memory: config.memory,
    targetReplyTo: config.heartbeatTargetOpenId,
    sessionKey: config.heartbeatSessionKey,
    intervalMs: config.heartbeatIntervalMs,
    onFailureHint: input.onFailureHint,
  });
}
