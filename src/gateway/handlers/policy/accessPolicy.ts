import { buildPairingQueueFullReply, buildPairingReply } from '../../../pairing/pairing-messages.js';
import { readChannelAllowFromStore, upsertChannelPairingRequest } from '../../../pairing/pairing-store.js';
import { type InboundMessage, type ChannelId } from '../../../channels/contracts.js';

const ACCESS_DENIED_MESSAGE = '当前策略不允许当前用户发起会话，请联系管理员配置后重试。';

interface AccessPolicyInput {
  inbound: InboundMessage;
  config: unknown;
}

export interface AccessPolicyDecision {
  allowed: boolean;
  replyText?: string;
}

interface AccessControlPolicyConfig {
  pairingPolicy?: string;
  pairingPendingTtlMs?: number;
  pairingPendingMax?: number;
  pairingAllowFrom?: string[];
}

function isChannelConfig(raw: unknown): raw is AccessControlPolicyConfig {
  return !!raw && typeof raw === 'object';
}

function normalizePolicy(rawPolicy: string | undefined): string {
  const policy = (rawPolicy || 'open').trim().toLowerCase();
  if (['open', 'allowlist', 'pairing', 'disabled'].includes(policy)) {
    return policy;
  }
  return 'open';
}

function buildDeniedReplyText(): string {
  return ACCESS_DENIED_MESSAGE;
}

function buildPairingQueueFullText(): string {
  return buildPairingQueueFullReply();
}

function buildPairingRequestText(
  requestId: string,
  actorId: string,
  code: string,
  channel: ChannelId,
): string {
  return buildPairingReply({
    channel,
    idLine: `${channel}: ${actorId}`,
    code,
  }) || `请在当前会话发送配对码: ${code}（requestId: ${requestId}）`;
}

function toList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => String(entry ?? '').trim().toLowerCase())
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parsePositiveInt(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return undefined;
}

export async function evaluateAccessPolicy(input: AccessPolicyInput): Promise<AccessPolicyDecision> {
  const actorId = (input.inbound.actorId || '').trim().toLowerCase();
  if (!actorId) {
    return {
      allowed: false,
      replyText: buildDeniedReplyText(),
    };
  }

  const channel = input.inbound.integration;
  if (!isChannelConfig(input.config)) {
    return { allowed: true };
  }

  const policy = normalizePolicy(input.config.pairingPolicy);
  if (policy === 'open') {
    return { allowed: true };
  }

  if (policy === 'disabled') {
    return {
      allowed: false,
      replyText: buildDeniedReplyText(),
    };
  }

  const allowFrom = toList(input.config.pairingAllowFrom);
  const allowFromFromStore = await readChannelAllowFromStore(channel).catch(() => []);
  const finalAllowFrom = Array.from(
    new Set([
      ...allowFrom,
      ...allowFromFromStore.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean),
    ]),
  );

  if (finalAllowFrom.includes('*') && finalAllowFrom.length > 0) {
    return { allowed: true };
  }

  if (finalAllowFrom.includes(actorId)) {
    return { allowed: true };
  }

  if (policy === 'allowlist') {
    return {
      allowed: false,
      replyText: buildDeniedReplyText(),
    };
  }

  const reply = await upsertChannelPairingRequest({
    channel,
    id: actorId,
    limits: {
      ttlMs: parsePositiveInt(input.config.pairingPendingTtlMs),
      maxPending: parsePositiveInt(input.config.pairingPendingMax),
    },
  });

  if (!reply.code) {
    return {
      allowed: false,
      replyText: buildPairingQueueFullText(),
    };
  }

  if (!reply.created) {
    return {
      allowed: false,
    };
  }

  return {
    allowed: false,
    replyText: buildPairingRequestText(input.inbound.requestId, input.inbound.actorId, reply.code, channel),
  };
}
