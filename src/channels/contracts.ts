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

export interface SidecarHandle {
  stop: () => Promise<void> | void;
}

export interface ChannelOutboundTextCapability {
  sendText: (replyTo: string, text: string, meta?: Record<string, unknown>) => Promise<void>;
}

export interface Channel {
  id: ChannelId;
  preflight: (overrides?: unknown, context?: ChannelRunContext) => Promise<unknown>;
  run: (onInbound: InboundHandler, overrides?: unknown, context?: ChannelRunContext) => Promise<void>;
  sendText?: ChannelOutboundTextCapability["sendText"];
  startSidecars?: (overrides?: unknown, context?: ChannelRunContext, preflightResult?: unknown) => Promise<SidecarHandle | void>;
}
