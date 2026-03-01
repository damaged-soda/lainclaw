import { parseGatewayArgs, parseFeishuServerArgs, parseLocalGatewayArgs } from '../../parsers/gateway.js';
import { parseGatewayConfigArgs } from '../../parsers/gatewayConfig.js';
import { sendFeishuTextMessage } from '../../../channels/feishu/outbound.js';
import { printUsage } from '../../usage.js';
import { runFeishuGatewayServer } from '../../../channels/feishu/server.js';
import { runLocalGatewayServer, type LocalGatewayOverrides } from '../../../channels/local/server.js';
import {
  buildFeishuGatewayConfigMigrationDraft,
  clearFeishuGatewayConfig,
  loadCachedFeishuGatewayConfigWithSources,
  persistFeishuGatewayConfig,
  resolveFeishuGatewayConfig,
  resolveFeishuGatewayConfigPath,
  type FeishuGatewayConfig,
  type FeishuGatewayConfigSources,
} from '../../../channels/feishu/config.js';
import { startHeartbeatLoop } from '../../../heartbeat/runner.js';
import {
  getGatewayServiceSnapshot,
  resolveGatewayServicePaths,
  spawnGatewayServiceProcess,
  resolveGatewayServiceStatus,
  stopGatewayService,
  type GatewayServicePaths,
  type GatewayServiceState,
  writeGatewayServiceState,
} from '../../../gateway/service.js';
import { runCommand } from '../../shared/result.js';
import {
  formatHeartbeatErrorHint,
  inspectHeartbeatTargetOpenId,
  makeFeishuFailureHint,
  maskConfigValue,
} from '../../../channels/feishu/diagnostics.js';
import { validateFeishuGatewayCredentials } from '../../../channels/feishu/credentials.js';

type GatewayChannel = "feishu" | "local";
type GatewayServiceChannel = GatewayChannel | "gateway";
type GatewayAction = "start" | "status" | "stop";
type GatewayStartOverrides = Partial<FeishuGatewayConfig> & Partial<LocalGatewayOverrides>;

export type GatewayParsedCommand = ReturnType<typeof parseGatewayArgs>;

export interface GatewayChannelPlugin {
  name: GatewayChannel;
  parseStartArgs: (argv: string[]) => GatewayStartOverrides;
  run: (overrides: GatewayStartOverrides, context: GatewayServiceRunContext) => Promise<void>;
}

export async function runGatewayCommand(args: string[]): Promise<number> {
  return runCommand(async () => {
    const subcommand = args[0];

    if (args.some((arg) => arg === '--help' || arg === '-h')) {
      console.log(printUsage());
      return 0;
    }

    if (subcommand === 'config') {
      try {
        return await runGatewayConfigCommand(args.slice(1));
      } catch (error) {
        console.error(
          "ERROR:",
          String(error instanceof Error ? error.message : error),
        );
        console.error(
          "Usage:",
          "  lainclaw gateway start [--channel <feishu|local> ...] [--provider <provider>] [--profile <profile>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--memory|--no-memory] [--heartbeat-enabled|--no-heartbeat-enabled] [--heartbeat-interval-ms <ms>] [--heartbeat-target-open-id <openId>] [--heartbeat-session-key <key>] [--pairing-policy <open|allowlist|pairing|disabled>] [--pairing-allow-from <id1,id2>] [--pairing-pending-ttl-ms <ms>] [--pairing-pending-max <n>] [--app-id <id>] [--app-secret <secret>] [--request-timeout-ms <ms>] [--debug] [--daemon] [--pid-file <path>] [--log-file <path>]",
          "  lainclaw gateway status [--channel <channel>] [--pid-file <path>]",
          "  lainclaw gateway stop [--channel <channel>] [--pid-file <path>]",
          "  lainclaw gateway config set [--channel <channel>] [--provider <provider>] [--profile <profile>] [--app-id <id>] [--app-secret <secret>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--memory|--no-memory] [--heartbeat-enabled|--no-heartbeat-enabled] [--heartbeat-interval-ms <ms>] [--heartbeat-target-open-id <openId>] [--heartbeat-session-key <key>] [--pairing-policy <open|allowlist|pairing|disabled>] [--pairing-pending-ttl-ms <ms>] [--pairing-pending-max <n>] [--request-timeout-ms <ms>]",
          "  lainclaw gateway config show [--channel <channel>]",
          "  lainclaw gateway config clear [--channel <channel>]",
          "  lainclaw gateway config migrate [--channel <channel>] --dry-run",
        );
        return 1;
      }
    }

    try {
      const parsed = parseGatewayArgs(args);
      if (parsed.action === "status") {
        return runGatewayStatusOrStop(parsed, "status");
      }
      if (parsed.action === "stop") {
        return runGatewayStatusOrStop(parsed, "stop");
      }
      return runGatewayStart(parsed);
    } catch (error) {
      console.error(
        "ERROR:",
        String(error instanceof Error ? error.message : error),
      );
      console.error(
        "Usage:",
        "  lainclaw gateway start [--channel <feishu|local> ...] [--provider <provider>] [--profile <profile>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--memory|--no-memory] [--heartbeat-enabled|--no-heartbeat-enabled] [--heartbeat-interval-ms <ms>] [--heartbeat-target-open-id <openId>] [--heartbeat-session-key <key>] [--pairing-policy <open|allowlist|pairing|disabled>] [--pairing-allow-from <id1,id2>] [--pairing-pending-ttl-ms <ms>] [--pairing-pending-max <n>] [--app-id <id>] [--app-secret <secret>] [--request-timeout-ms <ms>] [--debug] [--daemon] [--pid-file <path>] [--log-file <path>]",
        "  lainclaw gateway status [--channel <channel>] [--pid-file <path>]",
        "  lainclaw gateway stop [--channel <channel>] [--pid-file <path>]",
        "  lainclaw gateway config set [--channel <channel>] [--provider <provider>] [--profile <profile>] [--app-id <id>] [--app-secret <secret>] [--with-tools|--no-with-tools] [--tool-allow <tool1,tool2>] [--memory|--no-memory] [--heartbeat-enabled|--no-heartbeat-enabled] [--heartbeat-interval-ms <ms>] [--heartbeat-target-open-id <openId>] [--heartbeat-session-key <key>] [--pairing-policy <open|allowlist|pairing|disabled>] [--pairing-pending-ttl-ms <ms>] [--pairing-pending-max <n>] [--request-timeout-ms <ms>]",
        "  lainclaw gateway config show [--channel <channel>]",
        "  lainclaw gateway config clear [--channel <channel>]",
        "  lainclaw gateway config migrate [--channel <channel>] --dry-run",
      );
      return 1;
    }
  });
}

interface GatewayServiceRunContext {
  channel: GatewayServiceChannel;
  action?: GatewayAction;
  daemon?: boolean;
  statePath?: string;
  logPath?: string;
  serviceChild?: boolean;
  serviceArgv: string[];
  channels?: GatewayChannel[];
  debug?: boolean;
}

const GATEWAY_CHANNEL_PLUGINS: Record<GatewayChannel, GatewayChannelPlugin> = {
  feishu: {
    name: "feishu",
    parseStartArgs: parseFeishuServerArgs,
    run: (overrides, context) => runFeishuGatewayWithHeartbeat(
      overrides,
      makeFeishuFailureHint,
      context,
    ),
  },
  local: {
    name: "local",
    parseStartArgs: parseLocalGatewayArgs,
    run: (overrides, context) => runLocalGatewayService(overrides, context),
  },
};

function resolveGatewayChannelPlugin(rawChannel: string): GatewayChannelPlugin {
  const channel = rawChannel.trim().toLowerCase();
  const plugin = GATEWAY_CHANNEL_PLUGINS[channel as GatewayChannel];
  if (!plugin) {
    throw new Error(`Unsupported channel: ${rawChannel}`);
  }
  return plugin;
}

function normalizeGatewayChannels(rawChannels: GatewayChannel[]): GatewayChannel[] {
  const output: GatewayChannel[] = [];
  for (const channel of rawChannels) {
    if (!output.includes(channel)) {
      output.push(channel);
    }
  }
  return output;
}

export async function runGatewayStart(parsed: GatewayParsedCommand): Promise<number> {
  const {
    channel,
    channels,
    action,
    daemon,
    statePath,
    logPath,
    serviceChild,
    debug,
    serviceArgv,
    ...gatewayOptions
  } = parsed;
  if (action !== "start") {
    throw new Error(`Unsupported gateway action: ${action}`);
  }

  if (channels.length > 1) {
    await runGatewayServiceForChannels(
      gatewayOptions as GatewayStartOverrides,
      {
        channel,
        channels,
        action,
        debug,
        serviceChild,
        daemon,
        statePath,
        logPath,
        serviceArgv,
      },
      channels,
    );
    return 0;
  }

  const channelPlugin = resolveGatewayChannelPlugin(channel);
  await channelPlugin.run(
    gatewayOptions as GatewayStartOverrides,
    {
      channel,
      action,
      debug,
      serviceChild,
      daemon,
      statePath,
      logPath,
      serviceArgv,
    },
  );
  return 0;
}

export async function runGatewayStatusOrStop(
  parsed: GatewayParsedCommand,
  action: "status" | "stop",
): Promise<number> {
  await runGatewayServiceLifecycleAction({
    channel: "gateway",
    action,
    serviceChild: parsed.serviceChild,
    daemon: parsed.daemon,
    statePath: parsed.statePath,
    logPath: parsed.logPath,
    serviceArgv: parsed.serviceArgv,
  });
  return 0;
}

export async function runGatewayConfigCommand(args: string[]): Promise<number> {
  const parsed = parseGatewayConfigArgs(args);

  if (parsed.action === "set") {
    if (Object.keys(parsed.config).length === 0) {
      throw new Error("No gateway config fields provided");
    }
    await persistFeishuGatewayConfig(parsed.config, parsed.channel);
    console.log("gateway config updated");
    return 0;
  }

  if (parsed.action === "clear") {
    await clearFeishuGatewayConfig(parsed.channel);
    console.log("gateway config cleared");
    return 0;
  }

  if (parsed.action === "migrate") {
    const draft = await buildFeishuGatewayConfigMigrationDraft(
      parsed.channelProvided ? parsed.channel : undefined,
    );
    console.log(JSON.stringify(draft, null, 2));
    return 0;
  }

  const { config: cached, sources } = await loadCachedFeishuGatewayConfigWithSources(parsed.channel);
  const configPath = resolveFeishuGatewayConfigPath(parsed.channel);
  const config = Object.fromEntries(
    Object.entries(cached).map((entry) => {
      const key = entry[0];
      const value = entry[1];
      if (typeof value === "string" && (key === "appId" || key === "appSecret")) {
        return [
          key,
          {
            value: maskConfigValue(value),
            source: sources[key as keyof FeishuGatewayConfigSources],
          },
        ];
      }
      return [key, {
        value,
        source: sources[key as keyof FeishuGatewayConfigSources],
      }];
    }),
  );
  const masked = {
    channel: parsed.channel,
    configPath,
    config,
  };
  console.log(JSON.stringify(masked, null, 2));
  return 0;
}

export async function runGatewayServiceLifecycleAction(
  serviceContext: GatewayServiceRunContext,
): Promise<void> {
  const paths = resolveGatewayServicePaths(serviceContext.channel, {
    statePath: serviceContext.statePath,
    logPath: serviceContext.logPath,
  });

  if (serviceContext.action === "status") {
    await printGatewayServiceStatus(paths);
    return;
  }
  if (serviceContext.action !== "stop") {
    throw new Error(`Unsupported gateway action: ${serviceContext.action}`);
  }

  const snapshot = await getGatewayServiceSnapshot(paths);
  if (!snapshot.state || !snapshot.running) {
    console.log("gateway service already stopped");
    return;
  }
  await stopGatewayService(paths, snapshot.state);
  console.log(`gateway service stopped (pid=${snapshot.state.pid})`);
}

export async function runFeishuGatewayWithHeartbeat(
  overrides: Partial<FeishuGatewayConfig>,
  onFailureHint: (rawMessage: string) => string,
  serviceContext: GatewayServiceRunContext = {
    channel: "feishu",
    serviceArgv: [],
  },
): Promise<void> {
  const effectiveChannel: GatewayChannel = serviceContext.channel === "gateway" ? "feishu" : serviceContext.channel;
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

    const daemonArgv = ["gateway", "start", ...serviceContext.serviceArgv, "--service-child"];
    const scriptPath = process.argv[1];
    if (!scriptPath) {
      throw new Error("Cannot locate service entrypoint");
    }

    const daemonPid = await spawnGatewayServiceProcess(scriptPath, daemonArgv, paths);
    const daemonState: GatewayServiceState = {
      channel: effectiveChannel,
      channels: [effectiveChannel],
      pid: daemonPid,
      startedAt: new Date().toISOString(),
      command: `${process.execPath} ${scriptPath} ${daemonArgv.join(" ")}`.trim(),
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
        ...(typeof config.profileId === "string" && config.profileId.trim() ? { profileId: config.profileId.trim() } : {}),
        withTools: config.withTools,
        ...(Array.isArray(config.toolAllow) ? { toolAllow: config.toolAllow } : {}),
        memory: config.memory,
        sessionKey: config.heartbeatSessionKey,
        onSummary: (summary) => {
          console.log(formatHeartbeatSummary(summary));
        },
        onResult: (result) => {
          if (result.status === "triggered") {
            console.log(
              `[heartbeat] rule=${result.ruleId} triggered message=${result.message || "(no message)"}`,
            );
            return;
          }
          if (result.status === "skipped") {
            console.log(
              `[heartbeat] rule=${result.ruleId} skipped reason=${result.reason || result.message || "disabled/condition not met"}`,
            );
            return;
          }
          console.error(
            `[heartbeat] rule=${result.ruleId} errored reason=${formatHeartbeatErrorHint(
              result.reason || result.decisionRaw || "unknown error",
            )}`,
          );
        },
        send: async ({ rule, triggerMessage }) => {
          if (!config.heartbeatTargetOpenId) {
            throw new Error("heartbeat is enabled but heartbeatTargetOpenId is not configured");
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
            if (result.status === "errored") {
              console.error(
                `[heartbeat] startup rule=${result.ruleId} error=${formatHeartbeatErrorHint(
                  result.reason || result.decisionRaw || "unknown error",
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

export async function runGatewayServiceForChannels(
  overrides: GatewayStartOverrides,
  serviceContext: GatewayServiceRunContext,
  channels: GatewayChannel[],
): Promise<void> {
  const normalizedChannels = normalizeGatewayChannels(channels);
  if (normalizedChannels.length === 0) {
    throw new Error("At least one gateway channel is required");
  }

  if (serviceContext.daemon) {
  const paths = resolveGatewayServicePaths("gateway", {
      statePath: serviceContext.statePath,
      logPath: serviceContext.logPath,
    });
    const snapshot = await getGatewayServiceSnapshot(paths);
    if (snapshot.running) {
      throw new Error(`Gateway already running (pid=${snapshot.state?.pid})`);
    }

    for (const channel of normalizedChannels) {
      if (channel === "feishu") {
        await resolveFeishuGatewayRuntimeConfig(overrides, channel);
      }
    }

    const daemonArgv = ["gateway", "start", ...serviceContext.serviceArgv, "--service-child"];
    const scriptPath = process.argv[1];
    if (!scriptPath) {
      throw new Error("Cannot locate service entrypoint");
    }

    const daemonPid = await spawnGatewayServiceProcess(scriptPath, daemonArgv, paths);
    const daemonState: GatewayServiceState = {
      channel: "gateway",
      channels: normalizedChannels,
      pid: daemonPid,
      startedAt: new Date().toISOString(),
      command: `${process.execPath} ${scriptPath} ${daemonArgv.join(" ")}`.trim(),
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

  const startedChannels = normalizedChannels.map((channel) => {
    const plugin = resolveGatewayChannelPlugin(channel);
    return plugin.run(overrides, {
      ...serviceContext,
      channel,
    });
  });

  await Promise.all(startedChannels);
}

export async function runLocalGatewayService(
  overrides: Partial<LocalGatewayOverrides>,
  serviceContext: GatewayServiceRunContext = {
    channel: "local",
    serviceArgv: [],
  },
): Promise<void> {
  if (serviceContext.serviceChild) {
    await runLocalGatewayServer(overrides, { debug: serviceContext.debug });
    return;
  }

  const paths = resolveGatewayServicePaths(serviceContext.channel, {
    statePath: serviceContext.statePath,
    logPath: serviceContext.logPath,
  });

  if (serviceContext.daemon) {
    const snapshot = await getGatewayServiceSnapshot(paths);
    if (snapshot.running) {
      throw new Error(`Gateway already running (pid=${snapshot.state?.pid})`);
    }

    const daemonArgv = ["gateway", "start", ...serviceContext.serviceArgv, "--service-child"];
    const scriptPath = process.argv[1];
    if (!scriptPath) {
      throw new Error("Cannot locate service entrypoint");
    }

    const daemonPid = await spawnGatewayServiceProcess(scriptPath, daemonArgv, paths);
    const daemonState: GatewayServiceState = {
      channel: serviceContext.channel,
      channels: [serviceContext.channel],
      pid: daemonPid,
      startedAt: new Date().toISOString(),
      command: `${process.execPath} ${scriptPath} ${daemonArgv.join(" ")}`.trim(),
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

  await runLocalGatewayServer(overrides, { debug: serviceContext.debug });
}

export function printGatewayServiceStatus(
  paths: GatewayServicePaths,
  channel = "gateway",
): Promise<void> {
  return resolveGatewayServiceStatus(paths, channel);
}

async function resolveFeishuGatewayRuntimeConfig(
  overrides: Partial<FeishuGatewayConfig>,
  channel: GatewayChannel,
): Promise<FeishuGatewayConfig> {
  const config = await resolveFeishuGatewayConfig(overrides, channel);
  validateFeishuGatewayCredentials(config);
  if (config.heartbeatEnabled && !config.heartbeatTargetOpenId) {
    throw new Error("Missing value for heartbeat-target-open-id");
  }
  if (config.heartbeatEnabled && config.heartbeatTargetOpenId) {
    const targetDiagnostic = inspectHeartbeatTargetOpenId(config.heartbeatTargetOpenId);
    if (typeof targetDiagnostic.warning === "string" && targetDiagnostic.warning.length > 0) {
      if (targetDiagnostic.kind === "unknown") {
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
  const body = triggerMessage.trim() || "已触发";
  const lines = ["【Lainclaw 心跳提醒】", `规则：${ruleText}`, `内容：${body}`];
  return lines.join("\n");
}
