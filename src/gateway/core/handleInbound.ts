import { runAgent } from "../index.js";
import {
  type FeishuTextOutboundAction,
  type InboundMessage,
  type LocalOutboxErrorAction,
  type LocalOutboxSuccessAction,
  type OutboundAction,
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

  const input = (inbound.input || "").trim();
  if (!input) {
    return [];
  }

  const sessionKey = resolveSessionKey(inbound);

  if (options.channel === "feishu") {
    if (inbound.channel !== "feishu") {
      throw new Error("feishu handler received non-feishu message");
    }
    const decision = await evaluateFeishuAccessPolicy({
      inbound,
      config: options.config,
    });
    if (!decision.allowed) {
      return decision.outboundActions;
    }
  }

  try {
    const responseText = await runAgentWithTimeout({
      input,
      channelId: options.channel,
      sessionKey,
      runtime: options.runtime,
      timeoutMs: options.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS,
    });

    if (options.channel === "feishu") {
      if (inbound.channel !== "feishu") {
        throw new Error("feishu handler received non-feishu message");
      }
      return [
        buildFeishuReplyAction(inbound.requestId, inbound.openId, responseText),
      ];
    }

    const requestSource = inbound.requestSource || inbound.requestId;
    return [
      {
        kind: "local.outbox.success",
        channel: "local",
        requestId: inbound.requestId,
        requestSource,
        sessionKey,
        input,
        output: responseText,
      },
    ];
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const hint = options.onFailureHint ? options.onFailureHint(rawMessage) : rawMessage;

    if (options.channel === "feishu") {
      if (inbound.channel !== "feishu") {
        throw new Error("feishu handler received non-feishu message");
      }
      return [
        buildFeishuReplyAction(
          inbound.requestId,
          inbound.openId,
          `[Lainclaw] ${hint}（requestId: ${inbound.requestId}）`,
        ),
      ];
    }

    const requestSource = inbound.requestSource || inbound.requestId;
    return [
      {
        kind: "local.outbox.error",
        channel: "local",
        requestId: inbound.requestId,
        requestSource,
        sessionKey,
        input,
        error: rawMessage,
      },
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
  if (inbound.channel === "feishu") {
    return `feishu:dm:${inbound.openId}`;
  }

  const sessionHint = inbound.sessionHint?.trim();
  if (sessionHint) {
    return sessionHint;
  }

  const accountId = inbound.accountId?.trim();
  if (accountId) {
    return `local:${accountId}`;
  }

  return "local:main";
}

function buildFeishuReplyAction(requestId: string, openId: string, text: string): FeishuTextOutboundAction {
  return {
    kind: "feishu.sendText",
    channel: "feishu",
    requestId,
    openId,
    text,
  };
}
