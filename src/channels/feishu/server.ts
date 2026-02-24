import * as Lark from "@larksuiteoapi/node-sdk";
import { runAgent } from "../../gateway/gateway.js";
import { sendFeishuTextMessage } from "./outbound.js";
import { writeAgentAuditRecord } from "../../shared/agentAudit.js";
import {
  resolveFeishuGatewayConfig,
  type FeishuGatewayConfig,
  persistFeishuGatewayConfig,
} from "./config.js";
import {
  buildPairingQueueFullReply,
  buildPairingReply,
} from "../../pairing/pairing-messages.js";
import { readChannelAllowFromStore, upsertChannelPairingRequest } from "../../pairing/pairing-store.js";
import { resolvePairingIdLabel } from "../../pairing/pairing-labels.js";

interface FeishuWsMessageEvent {
  message?: {
    message_id?: string;
    chat_type?: string;
    chat_id?: string;
    content?: string;
    message_type?: string;
  };
  sender?: {
    sender_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
  };
}

interface FeishuInboundMessage {
  kind: "ignored" | "unsupported" | "dm-text";
  eventId?: string;
  messageId?: string;
  openId?: string;
  chatId?: string;
  chatType?: string;
  messageType?: string;
  input?: string;
  reason?: string;
  requestId: string;
}

const FEISHU_DM_CHAT_TYPES = new Set(["p2p", "private", "direct"]);
const EVENT_ID_TTL_MS = 10 * 60 * 1000;
const FEISHU_TEXT_MESSAGE_TYPE = "text";
const FEISHU_DENY_MESSAGE = "当前策略不允许当前用户发起会话，请联系管理员配置后重试。";

const EVENT_HISTORY = new Map<string, number>();
const REPLY_TIMEOUT_MS = 10000;

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

function buildDeniedReply() {
  return FEISHU_DENY_MESSAGE;
}

async function assertFeishuDmAllowed(params: {
  openId: string;
  config: FeishuGatewayConfig;
}): Promise<boolean> {
  const { openId, config } = params;
  const policy = resolvePairingPolicy(undefined, config.pairingPolicy);

  if (policy === "open") {
    return true;
  }
  if (policy === "disabled") {
    return false;
  }

  const fileAllowFrom = await readChannelAllowFromStore("feishu");
  const configAllowFrom = normalizeAllowFrom(config.pairingAllowFrom);
  const allowFrom = Array.from(new Set([...configAllowFrom, ...fileAllowFrom.map((entry) => String(entry).toLowerCase())]));
  if (isWildcardAllowFrom(allowFrom) && allowFrom.length > 0) {
    return true;
  }
  const normalizedOpenId = openId.trim().toLowerCase();
  if (!normalizedOpenId) {
    return false;
  }
  if (allowFrom.includes(normalizedOpenId)) {
    return true;
  }

  if (policy === "allowlist") {
    return false;
  }

  const reply = await upsertChannelPairingRequest({
    channel: "feishu",
    id: normalizedOpenId,
    limits: {
      ttlMs: config.pairingPendingTtlMs,
      maxPending: config.pairingPendingMax,
    },
  });
  if (!reply.code) {
    await sendFeishuTextMessage(config, {
      openId,
      text: buildPairingQueueFullReply(),
    });
    return false;
  }
  if (!reply.created) {
    return false;
  }
  await sendFeishuTextMessage(config, {
    text: buildPairingReply({
      channel: "feishu",
      idLine: `${resolvePairingIdLabel()}: ${openId}`,
      code: reply.code,
    }),
    openId,
  });
  return false;
}

function createRequestId() {
  const now = Date.now();
  return `feishu-${now}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function parseTextContent(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  const rawTrimmed = raw.trim();
  if (!rawTrimmed) {
    return "";
  }
  try {
    const parsed = JSON.parse(rawTrimmed);
    if (typeof parsed === "string") {
      return parsed;
    }
    if (parsed && typeof parsed === "object") {
      const candidate = parsed as Record<string, unknown>;
      if (typeof candidate.text === "string") {
        return candidate.text;
      }
    }
  } catch {
    return rawTrimmed;
  }
  return rawTrimmed;
}

function normalizeChatType(raw?: string): string {
  return (raw || "").trim().toLowerCase();
}

function inferChatType(chatId?: string): string {
  const normalized = (chatId || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("ou_") || normalized.startsWith("on_")) {
    return "p2p";
  }
  return "group";
}

function isReplay(eventId: string, ttlMs: number): boolean {
  const now = Date.now();
  for (const [key, expireAt] of EVENT_HISTORY.entries()) {
    if (expireAt <= now) {
      EVENT_HISTORY.delete(key);
    }
  }
  const existing = EVENT_HISTORY.get(eventId);
  if (existing && existing > now) {
    return true;
  }
  EVENT_HISTORY.set(eventId, now + ttlMs);
  return false;
}

function parseFeishuInbound(raw: unknown, requestId: string): FeishuInboundMessage {
  if (!raw || typeof raw !== "object") {
    return {
      kind: "ignored",
      requestId,
      reason: "invalid-payload",
    };
  }

  const event = raw as FeishuWsMessageEvent;
  const message = event.message ?? {};
  const messageId = firstNonEmpty(message.message_id, event.message?.message_id);
  const eventId = firstNonEmpty(messageId);
  const chatType = normalizeChatType(
    firstNonEmpty(message.chat_type, inferChatType(message.chat_id)) || inferChatType(message.chat_id),
  );
  const messageType = normalizeChatType(message.message_type);
  const openId = firstNonEmpty(
    event.sender?.sender_id?.open_id,
    event.sender?.sender_id?.user_id,
  );
  const chatId = firstNonEmpty(message.chat_id);
  const content = parseTextContent(message.content ?? "");

  if (!chatType) {
    return {
      kind: "ignored",
      reason: "missing-chat-type",
      requestId,
      eventId,
      messageId,
      openId,
      chatId,
      messageType,
    };
  }

  if (!FEISHU_DM_CHAT_TYPES.has(chatType)) {
    return {
      kind: "unsupported",
      reason: "non-direct-chat",
      requestId,
      eventId,
      messageId,
      openId,
      chatId,
      chatType,
      messageType,
    };
  }

  if (messageType && messageType !== FEISHU_TEXT_MESSAGE_TYPE) {
    return {
      kind: "unsupported",
      reason: "non-text-message",
      requestId,
      eventId,
      messageId,
      openId,
      chatId,
      chatType,
      messageType,
    };
  }

  if (!openId || !content) {
    return {
      kind: "ignored",
      reason: "missing-open-id-or-content",
      requestId,
      eventId,
      messageId,
      openId,
      chatId,
      chatType,
      messageType,
    };
  }

  return {
    kind: "dm-text",
    requestId,
    eventId,
    messageId,
    openId,
    chatId,
    chatType,
    messageType,
    input: content,
  };
}

async function handleWsPayload(
  data: unknown,
  config: FeishuGatewayConfig,
  options: FeishuGatewayServerOptions,
  onFailureHint?: (rawMessage: string) => string,
): Promise<void> {
  const requestId = createRequestId();
  let inbound: FeishuInboundMessage | undefined;
  try {
    inbound = parseFeishuInbound(data, requestId);
    if (inbound.kind !== "dm-text" || !inbound.openId || !inbound.input) {
      return;
    }

    if (inbound.eventId && isReplay(inbound.eventId, EVENT_ID_TTL_MS)) {
      return;
    }

    const allowed = await assertFeishuDmAllowed({
      openId: inbound.openId,
      config,
    });
    if (!allowed) {
      if (config.pairingPolicy === "allowlist" || config.pairingPolicy === "disabled") {
        await sendFeishuTextMessage(config, {
          openId: inbound.openId,
          text: buildDeniedReply(),
        });
      }
      return;
    }

    const runResult = await Promise.race([
      runAgent(inbound.input, {
        sessionKey: `feishu:dm:${inbound.openId}`,
        provider: config.provider,
        ...(typeof config.profileId === "string" && config.profileId.trim() ? { profileId: config.profileId.trim() } : {}),
        withTools: config.withTools,
        ...(Array.isArray(config.toolAllow) ? { toolAllow: config.toolAllow } : {}),
        ...(typeof config.toolMaxSteps === "number" ? { toolMaxSteps: config.toolMaxSteps } : {}),
        memory: config.memory,
        includePromptAudit: options.auditDebug,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`agent timeout after ${REPLY_TIMEOUT_MS}ms`));
        }, REPLY_TIMEOUT_MS);
      }),
    ]);

    if (runResult.promptAudit) {
          await writeAgentAuditRecord({
        channel: "feishu",
        requestId: runResult.requestId,
        requestSource: inbound.requestId,
        sessionKey: runResult.sessionKey,
        input: inbound.input,
        result: runResult,
        emitToStdout: options.auditDebug,
        auditStage: "runAgent.feishu.success",
        metadata: {
          inboundRequestId: inbound.requestId,
          openId: inbound.openId,
          chatId: inbound.chatId,
          chatType: inbound.chatType,
          messageId: inbound.messageId,
        },
      });
    }

    await sendFeishuTextMessage(config, {
      openId: inbound.openId,
      text: runResult.result,
    });
    console.log(
      `[feishu] ${requestId} answered dm for open_id=${inbound.openId} session=${runResult.sessionKey}/${runResult.sessionId}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (inbound?.openId && inbound.input) {
      const sessionKey = `feishu:dm:${inbound.openId}`;
        await writeAgentAuditRecord({
        channel: "feishu",
        requestId: inbound.requestId,
        requestSource: inbound.requestId,
        sessionKey,
        input: inbound.input,
        error: message,
        emitToStdout: options.auditDebug,
        auditStage: "runAgent.feishu.error",
        metadata: {
          inboundRequestId: inbound.requestId,
          openId: inbound.openId,
          chatId: inbound.chatId,
          chatType: inbound.chatType,
          messageId: inbound.messageId,
          context: inbound,
        },
      }).catch((writeError) => {
        console.warn(`[feishu] ${requestId} agent audit error-record failed: ${String(writeError)}`);
      });
    }
    console.error(`[feishu] ${requestId} error: ${message}`);
    if (inbound?.openId) {
      const reason =
        typeof onFailureHint === "function" ? onFailureHint(message) : "模型调用失败，请联系管理员查看服务日志。";
      const reply = `[Lainclaw] ${reason}（requestId: ${requestId}）`;
      await sendFeishuTextMessage(config, {
        openId: inbound.openId,
        text: reply,
      }).catch((sendError) => {
        console.error(`[feishu] ${requestId} failed to send fallback error: ${String(sendError)}`);
      });
    }
  }
}

export type FeishuFailureHintResolver = (rawMessage: string) => string;

interface FeishuGatewayServerOptions {
  onFailureHint?: FeishuFailureHintResolver;
  auditDebug?: boolean;
}

export async function runFeishuGatewayServer(
  overrides: Partial<FeishuGatewayConfig> = {},
  options: FeishuGatewayServerOptions = {},
  channel = "feishu",
): Promise<void> {
  const config = await resolveFeishuGatewayConfig(overrides, channel);
  await persistFeishuGatewayConfig(overrides, channel);

  if (!config.appId || !config.appSecret) {
    throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET for websocket mode");
  }

  const eventDispatcher = new Lark.EventDispatcher({});
  eventDispatcher.register({
    "im.message.receive_v1": async (data) => {
      await handleWsPayload(data, config, options, options.onFailureHint);
    },
  });

  const wsClient = new Lark.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    loggerLevel: Lark.LoggerLevel.info,
  });

  wsClient.start({ eventDispatcher });
  console.log("[feishu] websocket connection started");

  await new Promise<void>((resolve) => {
    const shutdown = (signal: string) => {
      console.log(`[feishu] ${signal} received, shutting down`);
      resolve();
    };
    const onSigInt = () => {
      shutdown("SIGINT");
      process.off("SIGINT", onSigInt);
      process.off("SIGTERM", onSigTerm);
    };
    const onSigTerm = () => {
      shutdown("SIGTERM");
      process.off("SIGINT", onSigInt);
      process.off("SIGTERM", onSigTerm);
    };
    process.once("SIGINT", onSigInt);
    process.once("SIGTERM", onSigTerm);
  });
}
