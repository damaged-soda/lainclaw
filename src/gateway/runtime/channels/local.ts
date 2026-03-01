import { runLocalGatewayServer, type LocalGatewayOverrides } from '../../../channels/local/server.js';
import {
  getGatewayServiceSnapshot,
  resolveGatewayServicePaths,
  spawnGatewayServiceProcess,
  type GatewayServiceState,
  writeGatewayServiceState,
} from '../../../gateway/service.js';
import { type GatewayServiceRunContext } from '../contracts.js';

export async function runLocalGatewayService(
  overrides: Partial<LocalGatewayOverrides>,
  serviceContext: GatewayServiceRunContext = {
    channel: 'local',
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

    const daemonArgv = ['gateway', 'start', ...serviceContext.serviceArgv, '--service-child'];
    const scriptPath = process.argv[1];
    if (!scriptPath) {
      throw new Error('Cannot locate service entrypoint');
    }

    const daemonPid = await spawnGatewayServiceProcess(scriptPath, daemonArgv, paths);
    const daemonState: GatewayServiceState = {
      channel: serviceContext.channel,
      channels: [serviceContext.channel],
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

  await runLocalGatewayServer(overrides, { debug: serviceContext.debug });
}
