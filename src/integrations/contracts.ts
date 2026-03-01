export type IntegrationId = "feishu" | "local";

export interface InboundMessageBase {
  integration: IntegrationId;
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

export interface IntegrationRunContext {
  integration: IntegrationId;
  [key: string]: unknown;
}

export interface SidecarHandle {
  stop: () => Promise<void> | void;
}

export interface IntegrationOutboundTextCapability {
  sendText: (replyTo: string, text: string, meta?: Record<string, unknown>) => Promise<void>;
}

export interface Integration {
  id: IntegrationId;
  preflight: (overrides?: unknown, context?: IntegrationRunContext) => Promise<unknown>;
  run: (onInbound: InboundHandler, overrides?: unknown, context?: IntegrationRunContext) => Promise<void>;
  sendText?: IntegrationOutboundTextCapability["sendText"];
  startSidecars?: (overrides?: unknown, context?: IntegrationRunContext, preflightResult?: unknown) => Promise<SidecarHandle | void>;
}
