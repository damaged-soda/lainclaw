import { startHeartbeatSidecar } from '../../../gateway/runtime/sidecars/heartbeat.js';
import type { FeishuGatewayConfig } from '../config.js';
import type { HeartbeatLoopHandle } from '../../../heartbeat/runner.js';
import type { Integration } from '../../../integrations/contracts.js';

interface StartFeishuHeartbeatSidecarInput {
  config: FeishuGatewayConfig;
  integration: Pick<Integration, 'sendText'>;
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
    integration: input.integration,
    enabled: config.heartbeatEnabled,
    provider: config.provider,
    ...(typeof config.profileId === 'string' && config.profileId.trim() ? { profileId: config.profileId.trim() } : {}),
    withTools: config.withTools,
    ...(Array.isArray(config.toolAllow) ? { toolAllow: config.toolAllow } : {}),
    memory: config.memory,
    heartbeatTargetOpenId: config.heartbeatTargetOpenId,
    sessionKey: config.heartbeatSessionKey,
    intervalMs: config.heartbeatIntervalMs,
    onFailureHint: input.onFailureHint,
  });
}
