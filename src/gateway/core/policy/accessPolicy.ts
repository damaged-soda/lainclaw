import { type FeishuGatewayConfig } from "../../../channels/feishu/config.js";
import { buildPairingQueueFullReply, buildPairingReply } from "../../../pairing/pairing-messages.js";
import { readChannelAllowFromStore, upsertChannelPairingRequest } from "../../../pairing/pairing-store.js";
import { resolvePairingIdLabel } from "../../../pairing/pairing-labels.js";
import type { FeishuInboundMessage } from "../../../transports/contracts.js";

const FEISHU_DENY_MESSAGE = "当前策略不允许当前用户发起会话，请联系管理员配置后重试。";

interface FeishuPolicyInput {
  inbound: FeishuInboundMessage;
  config: FeishuGatewayConfig;
}

export interface FeishuPolicyDecision {
  allowed: boolean;
  replyText?: string;
}

function isMatchingPairingPolicy(value: string | undefined): value is FeishuGatewayConfig["pairingPolicy"] {
  return value === "open" || value === "allowlist" || value === "pairing" || value === "disabled";
}

function normalizeAllowFrom(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((entry) => String(entry).trim())
    .map((entry) => entry.toLowerCase())
    .filter((entry) => entry.length > 0);
}

function isWildcardAllowFrom(allowFrom: string[]): boolean {
  return allowFrom.includes("*");
}

function resolvePairingPolicy(policy: string | undefined, configPolicy: FeishuGatewayConfig["pairingPolicy"]): string {
  if (isMatchingPairingPolicy(policy)) {
    return policy;
  }
  if (isMatchingPairingPolicy(configPolicy)) {
    return configPolicy;
  }
  return "open";
}

function buildDeniedReplyText(): string {
  return FEISHU_DENY_MESSAGE;
}

function buildPairingQueueFullText(): string {
  return buildPairingQueueFullReply();
}

function buildPairingRequestAction(
  _requestId: string,
  _openId: string,
  code: string,
): string {
  return buildPairingReply({
    channel: "feishu",
    idLine: `${resolvePairingIdLabel()}: ${_openId}`,
    code,
  });
}

export async function evaluateFeishuAccessPolicy(params: FeishuPolicyInput): Promise<FeishuPolicyDecision> {
  const normalizedOpenId = (params.inbound.actorId || "").trim().toLowerCase();
  const policy = resolvePairingPolicy(undefined, params.config.pairingPolicy);

  if (!normalizedOpenId) {
    return {
      allowed: false,
      replyText: buildDeniedReplyText(),
    };
  }

  if (policy === "open") {
    return {
      allowed: true,
    };
  }

  if (policy === "disabled") {
    return {
      allowed: false,
      replyText: buildDeniedReplyText(),
    };
  }

  const configAllowFrom = normalizeAllowFrom(params.config.pairingAllowFrom);
  const fileAllowFrom = await readChannelAllowFromStore("feishu");
  const allowFrom = Array.from(new Set([...configAllowFrom, ...fileAllowFrom.map((entry) => String(entry).toLowerCase())]));

  if (isWildcardAllowFrom(allowFrom) && allowFrom.length > 0) {
    return {
      allowed: true,
    };
  }

  if (allowFrom.includes(normalizedOpenId)) {
    return {
      allowed: true,
    };
  }

  if (policy === "allowlist") {
    return {
      allowed: false,
      replyText: buildDeniedReplyText(),
    };
  }

  const reply = await upsertChannelPairingRequest({
    channel: "feishu",
    id: normalizedOpenId,
    limits: {
      ttlMs: params.config.pairingPendingTtlMs,
      maxPending: params.config.pairingPendingMax,
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
    replyText: buildPairingRequestAction(params.inbound.requestId, params.inbound.actorId, reply.code),
  };
}
