import { runLocalGatewayServer, type LocalGatewayOverrides } from '../../../channels/local/server.js';
import { runGatewayServiceRunner } from '../serviceRunner.js';
import { type GatewayServiceRunContext, type GatewayChannel } from '../contracts.js';

export async function runLocalGatewayService(
  overrides: Partial<LocalGatewayOverrides>,
  serviceContext: GatewayServiceRunContext = {
    channel: 'local',
    serviceArgv: [],
  },
): Promise<void> {
  const context: GatewayServiceRunContext = {
    ...serviceContext,
    channel: serviceContext.channel ?? 'local',
    serviceArgv: serviceContext.serviceArgv ?? [],
  };

  await runGatewayServiceRunner({
    serviceContext: context,
    stateChannel: context.channel === 'gateway' ? 'local' : context.channel as GatewayChannel,
    runInProcess: async () => {
      await runLocalGatewayServer(overrides, { debug: context.debug });
    },
  });
}
