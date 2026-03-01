import { formatHeartbeatErrorHint, inspectHeartbeatTargetOpenId } from '../../../channels/feishu/diagnostics.js';
import { sendFeishuTextMessage } from '../../../channels/feishu/outbound.js';
import { runFeishuGatewayServer } from '../../../channels/feishu/server.js';
import { validateFeishuGatewayCredentials } from '../../../channels/feishu/credentials.js';
import { startHeartbeatLoop } from '../../../heartbeat/runner.js';
import {
  getGatewayServiceSnapshot,
  resolveGatewayServicePaths,
  spawnGatewayServiceProcess,
  type GatewayServiceState,
  writeGatewayServiceState,
} from '../../../gateway/service.js';
import {
  resolveFeishuGatewayConfig,
  type FeishuGatewayConfig,
} from '../../../channels/feishu/config.js';
import { type GatewayChannel, type GatewayServiceRunContext } from '../contracts.js';

export async function runFeishuGatewayWithHeartbeat(
  overrides: Partial<FeishuGatewayConfig>,
  onFailureHint: (rawMessage: string) => string,
  serviceContext: GatewayServiceRunContext = {
    channel: 'feishu',
    serviceArgv: [],
  },
): Promise<void> {
  const effectiveChannel: GatewayChannel = serviceContext.channel === 'gateway' ? 'feishu' : serviceContext.channel;
  if (serviceContext.serviceChild) {
    const config = await resolveFeishuGatewayRuntimeConfig(overrides, effectiveChannel);
    const heartbeatHandle = startHeartbeatIfEnabled(config);

    try {
      await runFeishuGatewayServer(
        overrides,
        {
          onFailureHint,
        },
        effectiveChannel,
      );
    } finally {
      heartbeatHandle?.stop();
    }
    return;
  }

  const paths = resolveGatewayServicePaths(serviceContext.channel, {
    statePath: serviceContext.statePath,
    logPath: serviceContext.logPath,
  });

  if (serviceContext.daemon) {
    await resolveFeishuGatewayRuntimeConfig(overrides, effectiveChannel);

    const snapshot = await getGatewayServiceSnapshot(paths);
    if (snapshot.running) {
      throw new Error(`Gateway already running (pid=${snapshot.state?.pid})`);
    }

    const daemonArgv = ['gateway', 'start', ...serviceContext.serviceArgv, '--service-child'];
    const scriptPath = process.argv[1];
    if (!scriptPath) {
      throw new Error('Cannot locate service entrypoint');
    }

    const daemonPid = await spawnGatewayServiceProcess(scriptPath, daemonArgv, paths);
    const daemonState: GatewayServiceState = {
      channel: effectiveChannel,
      channels: [effectiveChannel],
      pid: daemonPid,
      startedAt: new Date().toISOString(),
      command: `${process.execPath} ${scriptPath} ${daemonArgv.join(' ')}`.trim(),
      statePath: paths.statePath,
      logPath: paths.logPath,
      argv: [scriptPath, ...daemonArgv],
    };
    await writeGatewayServiceState(daemonState);
    console.log(`gateway service started as daemon: pid=${daemonPid}`);
    console.log(`status: ${paths.statePath}`);
    console.log(`log: ${paths.logPath}`);
    return;
  }

  const config = await resolveFeishuGatewayRuntimeConfig(overrides, effectiveChannel);
  const heartbeatHandle = startHeartbeatIfEnabled(config);

  try {
    await runFeishuGatewayServer(
      overrides,
      {
        onFailureHint,
      },
      effectiveChannel,
    );
  } finally {
    heartbeatHandle?.stop();
  }
}

function startHeartbeatIfEnabled(
  config: FeishuGatewayConfig,
): ReturnType<typeof startHeartbeatLoop> | undefined {
  const heartbeatHandle = config.heartbeatEnabled
    ? startHeartbeatLoop(config.heartbeatIntervalMs, {
      provider: config.provider,
      ...(typeof config.profileId === 'string' && config.profileId.trim() ? { profileId: config.profileId.trim() } : {}),
      withTools: config.withTools,
      ...(Array.isArray(config.toolAllow) ? { toolAllow: config.toolAllow } : {}),
      memory: config.memory,
      sessionKey: config.heartbeatSessionKey,
      onSummary: (summary) => {
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
            result.reason || result.decisionRaw || 'unknown error',
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
    })
    : undefined;

  if (heartbeatHandle) {
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
  }

  return heartbeatHandle;
}

export async function resolveFeishuGatewayRuntimeConfig(
  overrides: Partial<FeishuGatewayConfig>,
  channel: GatewayChannel,
): Promise<FeishuGatewayConfig> {
  const config = await resolveFeishuGatewayConfig(overrides, channel);
  validateFeishuGatewayCredentials(config);
  if (config.heartbeatEnabled && !config.heartbeatTargetOpenId) {
    throw new Error('Missing value for heartbeat-target-open-id');
  }
  if (config.heartbeatEnabled && config.heartbeatTargetOpenId) {
    const targetDiagnostic = inspectHeartbeatTargetOpenId(config.heartbeatTargetOpenId);
    if (typeof targetDiagnostic.warning === 'string' && targetDiagnostic.warning.length > 0) {
      if (targetDiagnostic.kind === 'unknown') {
        console.warn(`[heartbeat] ${targetDiagnostic.warning}`);
      } else {
        console.info(`[heartbeat] ${targetDiagnostic.warning}`);
      }
    }
  }
  return config;
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
