export type GatewayChannel = "feishu" | "local";

export interface GatewayCommandContext {
  channel: GatewayChannel;
  channels: GatewayChannel[];
  action: "start" | "status" | "stop";
  daemon?: boolean;
  statePath?: string;
  logPath?: string;
  serviceChild?: boolean;
  debug?: boolean;
  serviceArgv: string[];
}

export interface GatewayRuntimeInput {
  channel: GatewayChannel;
  daemon: boolean;
  statePath?: string;
  logPath?: string;
}

export function normalizeGatewayChannels(raw: GatewayChannel[]): GatewayChannel[] {
  const output: GatewayChannel[] = [];
  for (const item of raw) {
    if (!output.includes(item)) {
      output.push(item);
    }
  }
  return output;
}

import {
  clearGatewayServiceState,
  isProcessAlive,
  readGatewayServiceState,
  resolveGatewayServicePaths,
  terminateGatewayProcess,
  type GatewayServicePaths,
  type GatewayServiceState,
} from '../../gateway/service.js';

export interface GatewayStatusContext {
  channel: GatewayChannel;
  statePath?: string;
  logPath?: string;
}

export async function printGatewayServiceStatus(
  context: GatewayStatusContext,
  channel = "gateway",
): Promise<void> {
  const paths = resolveGatewayServicePaths(context.channel, {
    statePath: context.statePath,
    logPath: context.logPath,
  });
  const snapshot = await resolveGatewayServiceState(paths);

  if (!snapshot.state) {
    console.log(
      JSON.stringify(
        {
          status: "stopped",
          running: false,
          pid: null,
          channel,
          channels: [channel],
          statePath: paths.statePath,
          logPath: paths.logPath,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    JSON.stringify(
      {
        status: snapshot.running ? "running" : "stopped",
        running: snapshot.running,
        channel: snapshot.state.channel,
        channels: getGatewayStateChannels(snapshot.state),
        pid: snapshot.state.pid,
        startedAt: snapshot.state.startedAt,
        statePath: snapshot.state.statePath,
        logPath: snapshot.state.logPath,
        command: snapshot.state.command,
        argv: snapshot.state.argv,
      },
      null,
      2,
    ),
  );
}

export async function stopGatewayServiceIfRunning(
  context: GatewayStatusContext,
): Promise<void> {
  const paths = resolveGatewayServicePaths(context.channel, {
    statePath: context.statePath,
    logPath: context.logPath,
  });
  const snapshot = await resolveGatewayServiceState(paths);
  if (!snapshot.state || !snapshot.running) {
    console.log("gateway service already stopped");
    if (snapshot.state) {
      await clearGatewayServiceState(paths.statePath);
    }
    return;
  }

  const stopped = await terminateGatewayProcess(snapshot.state.pid);
  if (!stopped) {
    throw new Error(`Failed to stop gateway process (pid=${snapshot.state.pid})`);
  }
  await clearGatewayServiceState(paths.statePath);
  console.log(`gateway service stopped (pid=${snapshot.state.pid})`);
}

export function isGatewayServiceRunning(state: GatewayServiceState): boolean {
  return isProcessAlive(state.pid);
}

async function resolveGatewayServiceState(
  paths: GatewayServicePaths,
): Promise<{ state: GatewayServiceState | null; running: boolean; stale: boolean }> {
  const state = await readGatewayServiceState(paths.statePath);
  if (!state) {
    return { state: null, running: false, stale: false };
  }

  const alive = isGatewayServiceRunning(state);
  if (!alive) {
    await clearGatewayServiceState(paths.statePath);
    return { state, running: false, stale: true };
  }

  return { state, running: true, stale: false };
}

function getGatewayStateChannels(state: GatewayServiceState): string[] {
  if (Array.isArray(state.channels) && state.channels.length > 0) {
    return [...new Set(state.channels.filter((item) => typeof item === "string" && item.trim().length > 0))];
  }
  return [state.channel];
}
