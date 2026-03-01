export type ChannelId = "feishu" | "local";

export interface InboundMessageBase {
  kind: "message" | "ignored";
  channel: ChannelId;
  requestId: string;
  input: string;
  actorId: string;
  conversationId: string;
  replyTo: string;
}

export interface FeishuInboundMessage extends InboundMessageBase {
  kind: "message";
  channel: "feishu";
}

export interface LocalInboundMessage extends InboundMessageBase {
  kind: "message";
  channel: "local";
}

export interface IgnoredInboundMessage extends InboundMessageBase {
  kind: "ignored";
  reason: string;
}

export type InboundMessage = FeishuInboundMessage | LocalInboundMessage | IgnoredInboundMessage;

export interface ReplyTextOutboundAction {
  kind: "reply.text";
  channel: ChannelId;
  requestId: string;
  replyTo: string;
  text: string;
  meta?: Record<string, unknown>;
}

export type OutboundAction = ReplyTextOutboundAction;

export type InboundHandler = (inbound: InboundMessage) => Promise<readonly OutboundAction[]>;

export interface Transport {
  channel: ChannelId;
  run: (handler: InboundHandler) => Promise<void>;
}
