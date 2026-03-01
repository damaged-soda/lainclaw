import type { GatewayServicePaths, GatewayServiceState } from "./servicePaths.js";
import {
  clearGatewayServiceState,
  readGatewayServiceState,
} from "./serviceState.js";
import { isProcessAlive, terminateGatewayProcess } from "./serviceProcess.js";

export interface GatewayServiceSnapshot {
  state: GatewayServiceState | null;
  running: boolean;
  stale: boolean;
}

export async function getGatewayServiceSnapshot(
  paths: GatewayServicePaths,
): Promise<GatewayServiceSnapshot> {
  const state = await readGatewayServiceState(paths.statePath);
  if (!state) {
    return { state: null, running: false, stale: false };
  }

  const running = isProcessAlive(state.pid);
  if (!running) {
    await clearGatewayServiceState(paths.statePath);
    return { state, running: false, stale: true };
  }

  return { state, running: true, stale: false };
}

function getGatewayServiceStateChannels(state: GatewayServiceState): string[] {
  if (Array.isArray(state.channels) && state.channels.length > 0) {
    return [...new Set(state.channels.filter((item) => item.trim().length > 0))];
  }
  return [state.channel];
}

export async function stopGatewayService(
  paths: GatewayServicePaths,
  state: GatewayServiceState,
): Promise<void> {
  const stopped = await terminateGatewayProcess(state.pid);
  if (!stopped) {
    throw new Error(`Failed to stop gateway process (pid=${state.pid})`);
  }
  await clearGatewayServiceState(paths.statePath);
}

export async function resolveGatewayServiceStatus(
  paths: GatewayServicePaths,
  channel = "gateway",
): Promise<void> {
  const snapshot = await getGatewayServiceSnapshot(paths);
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
        channels: getGatewayServiceStateChannels(snapshot.state),
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
