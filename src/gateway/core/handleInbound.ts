import { runAgent } from "../index.js";
import type {
  FeishuInboundMessage,
  InboundMessage,
  OutboundAction,
  ReplyTextOutboundAction,
} from "../../transports/contracts.js";
import type { FeishuGatewayConfig } from "../../channels/feishu/config.js";
import { evaluateFeishuAccessPolicy } from "./policy/accessPolicy.js";

// Core 入口：只编排入站消息语义、准入策略、模型调用与统一错误兜底。
// 真实输出动作仍由 transports 执行。

const DEFAULT_AGENT_TIMEOUT_MS = 10000;

interface AgentRuntimeContext {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  toolAllow?: string[];
  memory?: boolean;
}

interface FeishuHandleOptions {
  channel: "feishu";
  runtime: AgentRuntimeContext;
  config: FeishuGatewayConfig;
  timeoutMs?: number;
  onFailureHint?: (rawMessage: string) => string;
}

interface LocalHandleOptions {
  channel: "local";
  runtime: AgentRuntimeContext;
  timeoutMs?: number;
  onFailureHint?: (rawMessage: string) => string;
}

export type HandleInboundOptions = FeishuHandleOptions | LocalHandleOptions;

export async function handleInbound(
  inbound: InboundMessage,
  options: HandleInboundOptions,
): Promise<readonly OutboundAction[]> {
  if (inbound.kind !== "message") {
    return [];
  }

  const input = inbound.input.trim();
  if (!input) {
    return [];
  }

  const sessionKey = resolveSessionKey(inbound);

  if (options.channel === "feishu") {
    if (inbound.channel !== "feishu") {
      throw new Error("feishu handler received non-feishu message");
    }
    const decision = await evaluateFeishuAccessPolicy({
      inbound: inbound as FeishuInboundMessage,
      config: options.config,
    });
    if (!decision.allowed) {
      if (!decision.replyText) {
        return [];
      }
      return [buildReplyTextAction(inbound, decision.replyText)];
    }
  }

  try {
    const responseText = await runAgentWithTimeout({
      input,
      channelId: inbound.channel,
      sessionKey,
      runtime: options.runtime,
      timeoutMs: options.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS,
    });

    return [buildReplyTextAction(inbound, responseText)];
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const hint = options.onFailureHint ? options.onFailureHint(rawMessage) : rawMessage;
    return [
      buildReplyTextAction(
        inbound,
        `[Lainclaw] ${hint}（requestId: ${inbound.requestId}）`,
      ),
    ];
  }
}

interface AgentRequest {
  input: string;
  channelId: "feishu" | "local";
  sessionKey: string;
  runtime: AgentRuntimeContext;
  timeoutMs: number;
}

async function runAgentWithTimeout(params: AgentRequest): Promise<string> {
  const timeoutMs = Number.isFinite(params.timeoutMs) && params.timeoutMs > 0
    ? params.timeoutMs
    : DEFAULT_AGENT_TIMEOUT_MS;

  const invoke = runAgent({
    input: params.input,
    channelId: params.channelId,
    sessionKey: params.sessionKey,
    runtime: {
      provider: params.runtime.provider,
      profileId: params.runtime.profileId,
      withTools: params.runtime.withTools,
      toolAllow: params.runtime.toolAllow,
      memory: params.runtime.memory,
    },
  });

  const timeout = new Promise<string>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`agent timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const result = await Promise.race([invoke, timeout]);
  return (result as { text: string }).text;
}

function resolveSessionKey(inbound: InboundMessage): string {
  const actorId = inbound.actorId.trim() || inbound.requestId;
  const conversationId = inbound.conversationId.trim() || inbound.requestId;
  if (inbound.channel === "local") {
    return `${actorId}:${conversationId}`;
  }
  return `${inbound.channel}:${actorId}:${conversationId}`;
}

function buildReplyTextAction(
  inbound: InboundMessage,
  text: string,
): ReplyTextOutboundAction {
  return {
    kind: "reply.text",
    channel: inbound.channel,
    requestId: inbound.requestId,
    replyTo: inbound.replyTo,
    text,
  };
}
