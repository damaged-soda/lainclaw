import { inspectHeartbeatTargetOpenId } from './diagnostics.js';
import { validateFeishuGatewayCredentials } from './credentials.js';
import { resolveFeishuChannelConfig, type FeishuChannelConfig } from './config.js';
import { runFeishuTransport } from './transport.js';
import {
  type Channel,
  type ChannelPreflightInput,
  type ChannelRunInput,
  type ChannelRunContext,
  type ChannelSendTextOptions,
} from '../contracts.js';
import { sendFeishuTextMessage } from './outbound.js';

function normalizeFeishuChannelConfigOverrides(overrides: unknown): Partial<FeishuChannelConfig> {
  if (!overrides || typeof overrides !== 'object') {
    return {};
  }
  return overrides as Partial<FeishuChannelConfig>;
}

async function toChannelConfig(overrides: unknown, context?: ChannelRunContext): Promise<FeishuChannelConfig> {
  const channel = context?.channel ?? 'feishu';
  return resolveFeishuChannelConfig(normalizeFeishuChannelConfigOverrides(overrides), channel);
}

function resolveSendTextConfig(options?: ChannelSendTextOptions): Partial<FeishuChannelConfig> {
  if (!options?.config || typeof options.config !== 'object') {
    return {};
  }
  return options.config as Partial<FeishuChannelConfig>;
}

export const feishuChannel: Channel = {
  id: 'feishu',
  preflight: async (input?: ChannelPreflightInput): Promise<FeishuChannelConfig> => {
    const config = await toChannelConfig(input?.config, input?.context);
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
  },
  sendText: async (replyTo, text, options): Promise<void> => {
    if (!replyTo || !text.trim()) {
      return;
    }
    const config = await toChannelConfig(resolveSendTextConfig(options), { channel: 'feishu' } as ChannelRunContext);
    await sendFeishuTextMessage(config, {
      openId: replyTo,
      text,
    });
  },
  run: async (input: ChannelRunInput): Promise<void> => {
    const config = await toChannelConfig(input.config, input.context);
    await runFeishuTransport({
      config,
      onInbound: (inbound) => input.binding.onInbound(inbound),
    });
  },
};
