import { startHeartbeatLoop } from '../../../heartbeat/runner.js';
import type { Integration } from '../../../integrations/contracts.js';
import type { HeartbeatLoopHandle, HeartbeatRunSummary } from '../../../heartbeat/runner.js';

type HeartbeatFailureHint = (rawMessage: string) => string;

interface HeartbeatSidecarInput {
  integration: Pick<Integration, 'sendText'>;
  enabled: boolean;
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  toolAllow?: string[];
  memory?: boolean;
  sessionKey?: string;
  heartbeatTargetOpenId?: string;
  intervalMs: number;
  onFailureHint?: HeartbeatFailureHint;
}

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

export function startHeartbeatSidecar(
  input: HeartbeatSidecarInput,
): HeartbeatLoopHandle | undefined {
  if (!input.enabled) {
    return undefined;
  }

  const heartbeatHandle = startHeartbeatLoop(input.intervalMs, {
    provider: input.provider,
    ...(typeof input.profileId === 'string' && input.profileId.trim() ? { profileId: input.profileId.trim() } : {}),
    withTools: input.withTools,
    ...(Array.isArray(input.toolAllow) ? { toolAllow: input.toolAllow } : {}),
    memory: input.memory,
    sessionKey: input.sessionKey,
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
        `[heartbeat] rule=${result.ruleId} errored reason=${input.onFailureHint?.(
          result.reason || result.decisionRaw || 'unknown error',
        ) || result.reason || result.decisionRaw || 'unknown error'}`,
      );
    },
    send: async ({ rule, triggerMessage }) => {
      if (!input.heartbeatTargetOpenId) {
        throw new Error('heartbeat is enabled but heartbeatTargetOpenId is not configured');
      }
      await input.integration.sendText(input.heartbeatTargetOpenId, buildHeartbeatMessage(rule.ruleText, triggerMessage));
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
              `[heartbeat] startup rule=${result.ruleId} error=${input.onFailureHint?.(
                result.reason || result.decisionRaw || 'unknown error',
              ) || result.reason || result.decisionRaw || 'unknown error'}`,
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
