export type ChannelId = "feishu" | "local";

export interface InboundMessageBase {
  channel: ChannelId;
  requestId: string;
  actorId: string;
  conversationId: string;
  replyTo: string;
  text: string;
  meta?: Record<string, unknown>;
}

export interface MessageInboundMessage extends InboundMessageBase {
  kind: "message";
}

export interface IgnoredInboundMessage extends InboundMessageBase {
  kind: "ignored";
  reason: string;
}

export type InboundMessage = MessageInboundMessage | IgnoredInboundMessage;

export interface OutboundMessage {
  requestId: string;
  replyTo: string;
  text: string;
  meta?: Record<string, unknown>;
}

export type InboundHandler = (inbound: InboundMessage) => Promise<OutboundMessage | void>;

export interface ChannelRunContext {
  channel: ChannelId;
  [key: string]: unknown;
}

export interface ChannelSendTextOptions {
  config?: unknown;
  meta?: Record<string, unknown>;
}

export type ChannelSendText = (
  replyTo: string,
  text: string,
  options?: ChannelSendTextOptions,
) => Promise<void>;

export interface ChannelPreflightInput {
  config?: unknown;
  context?: ChannelRunContext;
}

export interface ChannelRunInput {
  config?: unknown;
  context?: ChannelRunContext;
  onInbound: InboundHandler;
}

export interface Channel {
  id: ChannelId;
  preflight?: (input: ChannelPreflightInput) => Promise<unknown>;
  run: (input: ChannelRunInput) => Promise<void>;
  sendText?: ChannelSendText;
}
