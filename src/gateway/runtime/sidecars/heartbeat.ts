import { formatHeartbeatErrorHint } from '../../../channels/feishu/diagnostics.js';
import { sendFeishuTextMessage } from '../../../channels/feishu/outbound.js';
import { startHeartbeatLoop } from '../../../heartbeat/runner.js';
import type { FeishuGatewayConfig } from '../../../channels/feishu/config.js';
import type { HeartbeatLoopHandle, HeartbeatRunSummary } from '../../../heartbeat/runner.js';

// Sidecar：与 transport 解耦，由 runtime 在前台组合启动。

type HeartbeatFailureHint = (rawMessage: string) => string;

function formatHeartbeatSummary(summary: {
  ranAt: string;
  total: number;
  triggered: number;
  skipped: number;
  errors: number;
}): string {
  return `[heartbeat] ranAt=${summary.ranAt} total=${summary.total} triggered=${summary.triggered} skipped=${summary.skipped} errors=${summary.errors}`;
}

function buildHeartbeatMessage(ruleText: string, triggerMessage: string): string {
  const body = triggerMessage.trim() || '已触发';
  const lines = ['【Lainclaw 心跳提醒】', `规则：${ruleText}`, `内容：${body}`];
  return lines.join('\n');
}

export function startFeishuHeartbeatSidecar(
  config: FeishuGatewayConfig,
  onFailureHint: HeartbeatFailureHint = (rawMessage) => rawMessage,
): HeartbeatLoopHandle | undefined {
  if (!config.heartbeatEnabled) {
    return undefined;
  }

  const heartbeatHandle = startHeartbeatLoop(config.heartbeatIntervalMs, {
    provider: config.provider,
    ...(typeof config.profileId === 'string' && config.profileId.trim() ? { profileId: config.profileId.trim() } : {}),
    withTools: config.withTools,
    ...(Array.isArray(config.toolAllow) ? { toolAllow: config.toolAllow } : {}),
    memory: config.memory,
    sessionKey: config.heartbeatSessionKey,
    onSummary: (summary: HeartbeatRunSummary) => {
      console.log(formatHeartbeatSummary(summary));
    },
    onResult: (result) => {
      if (result.status === 'triggered') {
        console.log(
          `[heartbeat] rule=${result.ruleId} triggered message=${result.message || '(no message)'}`,
        );
        return;
      }
      if (result.status === 'skipped') {
        console.log(
          `[heartbeat] rule=${result.ruleId} skipped reason=${result.reason || result.message || 'disabled/condition not met'}`,
        );
        return;
      }
      console.error(
        `[heartbeat] rule=${result.ruleId} errored reason=${formatHeartbeatErrorHint(
          onFailureHint(result.reason || result.decisionRaw || 'unknown error'),
        )}`,
      );
    },
    send: async ({ rule, triggerMessage }) => {
      if (!config.heartbeatTargetOpenId) {
        throw new Error('heartbeat is enabled but heartbeatTargetOpenId is not configured');
      }
      await sendFeishuTextMessage(config, {
        openId: config.heartbeatTargetOpenId,
        text: buildHeartbeatMessage(rule.ruleText, triggerMessage),
      });
    },
  });

  heartbeatHandle
    .runOnce()
    .then((summary) => {
      console.log(
        `[heartbeat] startup runAt=${summary.ranAt} triggered=${summary.triggered} skipped=${summary.skipped} errors=${summary.errors}`,
      );
      if (summary.errors > 0) {
        for (const result of summary.results) {
          if (result.status === 'errored') {
            console.error(
              `[heartbeat] startup rule=${result.ruleId} error=${formatHeartbeatErrorHint(
                result.reason || result.decisionRaw || 'unknown error',
              )}`,
            );
          }
        }
      }
    })
    .catch((error) => {
      console.error(`[heartbeat] startup run failed: ${String(error instanceof Error ? error.message : error)}`);
    });

  return heartbeatHandle;
}
