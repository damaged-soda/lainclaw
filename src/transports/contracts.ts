export type TransportChannel = "feishu" | "local";

export interface InboundMessageBase {
  kind: "message" | "ignored";
  channel: TransportChannel;
  requestId: string;
  /**
   * 已解析出的输入内容。忽略类消息该字段可为空。
   */
  input?: string;
  /**
   * 协议层可选的会话提示字段。由 core 统一计算最终 sessionKey。
   */
  sessionHint?: string;
  /**
   * 可选的外部请求标识，例如 local 适配层产生的序列号。
   */
  requestSource?: string;
  /**
   * 本地场景可用的账号标识。
   */
  accountId?: string;
}

export interface FeishuInboundMessage extends InboundMessageBase {
  kind: "message";
  channel: "feishu";
  openId: string;
}

export interface LocalInboundMessage extends InboundMessageBase {
  kind: "message";
  channel: "local";
}

export interface IgnoredInboundMessage extends InboundMessageBase {
  kind: "ignored";
  reason: string;
  openId?: string;
}

export type InboundMessage = FeishuInboundMessage | LocalInboundMessage | IgnoredInboundMessage;

export interface FeishuTextOutboundAction {
  kind: "feishu.sendText";
  channel: "feishu";
  requestId: string;
  openId: string;
  text: string;
}

export interface LocalOutboxSuccessAction {
  kind: "local.outbox.success";
  channel: "local";
  requestId: string;
  requestSource: string;
  sessionKey: string;
  input: string;
  output: string;
}

export interface LocalOutboxErrorAction {
  kind: "local.outbox.error";
  channel: "local";
  requestId: string;
  requestSource: string;
  sessionKey: string;
  input: string;
  error: string;
}

export type OutboundAction = FeishuTextOutboundAction | LocalOutboxSuccessAction | LocalOutboxErrorAction;

export type InboundHandler = (inbound: InboundMessage) => Promise<readonly OutboundAction[]>;

export interface Transport {
  channel: TransportChannel;
  run: (handler: InboundHandler) => Promise<void>;
}
