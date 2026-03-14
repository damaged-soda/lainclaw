export function inspectHeartbeatTargetOpenId(raw: string): {
  kind: "open-user-id" | "chat-id" | "legacy-user-id" | "unknown";
  warning?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      kind: "unknown",
      warning: "heartbeat target open id is empty, heartbeat is effectively disabled",
    };
  }

  if (trimmed.startsWith("ou_") || trimmed.startsWith("on_")) {
    return {
      kind: "open-user-id",
    };
  }

  if (trimmed.startsWith("oc_")) {
    return {
      kind: "chat-id",
      warning:
        "检测到 oc_ 前缀，通常为会话ID/群ID；当前会尝试按会话消息发送，若期望私聊提醒请改为用户 open_id（ou_/on_）。",
    };
  }

  if (trimmed.startsWith("u_") || trimmed.startsWith("user_")) {
    return {
      kind: "legacy-user-id",
      warning: "检测到疑似旧 user_id，飞书发送可能需要换用 open_id（ou_/on_）；系统会继续尝试发送。",
    };
  }

  return {
    kind: "unknown",
    warning:
      "heartbeat target open id 前缀不在已识别范围内（ou_/on_/oc_）。系统会继续尝试发送，但建议你确认是否为有效接收人 open_id。",
  };
}

export function maskConfigValue(raw: string | undefined): string | undefined {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= 6) {
    return "*".repeat(trimmed.length);
  }
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-3)}`;
}
