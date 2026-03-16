import type { ToolContext, ToolSpec } from "../types.js";
import { sendFeishuWebhookTextMessage } from "../../channels/feishu/outbound.js";
import { hasOutboundChannel, sendOutboundMessage } from "../outboundRegistry.js";

const HEARTBEAT_SESSION_PREFIX = "heartbeat";

function isHeartbeatSession(sessionKey: string): boolean {
  const normalized = sessionKey.trim().toLowerCase();
  return normalized === HEARTBEAT_SESSION_PREFIX || normalized.startsWith(`${HEARTBEAT_SESSION_PREFIX}:`);
}

export const sendMessageTool: ToolSpec = {
  name: "send_message",
  description: "通过已注册的 channel 主动向指定目标发送文本消息，或通过 Feishu webhook 直接发送。当前仅用于 heartbeat 场景。",
  inputSchema: {
    type: "object",
    required: ["channel", "text"],
    properties: {
      channel: {
        type: "string",
        description: "消息发送通道，例如 feishu。",
      },
      to: {
        type: "string",
        description: "目标标识，例如 Feishu open_id。",
      },
      text: {
        type: "string",
        description: "要发送的文本内容。",
      },
      webhookUrl: {
        type: "string",
        description: "Feishu webhook 地址；提供后将直接通过 webhook 发送。",
      },
      webhook_url: {
        type: "string",
        description: "webhookUrl 的兼容别名。",
      },
      webhookSecret: {
        type: "string",
        description: "Feishu webhook 签名密钥；仅在 webhook 开启签名校验时需要。",
      },
      webhook_secret: {
        type: "string",
        description: "webhookSecret 的兼容别名。",
      },
    },
  },
  handler: async (context: ToolContext, args: Record<string, unknown>) => {
    const channel = typeof args.channel === "string" ? args.channel.trim() : "";
    const to = typeof args.to === "string" ? args.to.trim() : "";
    const text = typeof args.text === "string" ? args.text.trim() : "";
    const webhookUrl =
      typeof args.webhookUrl === "string"
        ? args.webhookUrl.trim()
        : typeof args.webhook_url === "string"
          ? args.webhook_url.trim()
          : "";
    const webhookSecret =
      typeof args.webhookSecret === "string"
        ? args.webhookSecret.trim()
        : typeof args.webhook_secret === "string"
          ? args.webhook_secret.trim()
          : "";

    if (!isHeartbeatSession(context.sessionKey)) {
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "send_message",
          message: "send_message is only available in heartbeat sessions",
        },
      };
    }

    if (!channel) {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "send_message",
          message: "channel must be a non-empty string",
        },
      };
    }
    if (!text) {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "send_message",
          message: "text must be a non-empty string",
        },
      };
    }
    if (!to && !webhookUrl) {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "send_message",
          message: "either to or webhookUrl must be provided",
        },
      };
    }
    if (webhookUrl) {
      if (channel !== "feishu") {
        return {
          ok: false,
          error: {
            code: "invalid_args",
            tool: "send_message",
            message: "webhookUrl is only supported for channel=feishu",
          },
        };
      }

      try {
        await sendFeishuWebhookTextMessage({
          webhookUrl,
          text,
          ...(webhookSecret ? { secret: webhookSecret } : {}),
        });
        return {
          ok: true,
          content: `Sent message via ${channel} webhook`,
          data: {
            channel,
            webhook: true,
            sent: true,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "execution_error",
            tool: "send_message",
            message: error instanceof Error ? error.message : "failed to send outbound message",
          },
        };
      }
    }
    if (!hasOutboundChannel(channel)) {
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "send_message",
          message: `outbound channel not available: ${channel}`,
        },
      };
    }

    try {
      await sendOutboundMessage(channel, to, text);
      return {
        ok: true,
        content: `Sent message via ${channel} to ${to}`,
        data: {
          channel,
          to,
          sent: true,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "send_message",
          message: error instanceof Error ? error.message : "failed to send outbound message",
        },
      };
    }
  },
};
