import {
  getGatewayServiceSnapshot,
  resolveGatewayServicePaths,
  spawnGatewayServiceProcess,
  writeGatewayServiceState,
  type GatewayServicePaths,
  type GatewayServiceState,
} from '../../gateway/service.js';
import { type GatewayChannel } from './contracts.js';
import type { GatewayServiceRunContext } from './contracts.js';

export interface GatewayServiceRunOptions {
  serviceContext: GatewayServiceRunContext;
  stateChannel: GatewayChannel | 'gateway';
  stateChannels?: GatewayChannel[];
  runInProcess: () => Promise<void>;
  preflight?: () => Promise<void>;
}

// 运行态入口：统一管理 daemon 状态落盘、生命周期守护与 service-child 分支。

function buildGatewayServicePaths(
  stateChannel: GatewayChannel | 'gateway',
  serviceContext: GatewayServiceRunContext,
): GatewayServicePaths {
  return resolveGatewayServicePaths(stateChannel, {
    statePath: serviceContext.statePath,
    logPath: serviceContext.logPath,
  });
}

export async function runGatewayServiceRunner(options: GatewayServiceRunOptions): Promise<void> {
  const {
    serviceContext,
    stateChannel,
    stateChannels,
    runInProcess,
    preflight,
  } = options;

  if (serviceContext.serviceChild) {
    await runInProcess();
    return;
  }

  const paths = buildGatewayServicePaths(stateChannel, serviceContext);

  if (serviceContext.daemon) {
    if (preflight) {
      await preflight();
    }

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
      channel: stateChannel,
      channels: stateChannels,
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

  await runInProcess();
}
