export function makeFeishuFailureHint(rawMessage: string): string {
  return parseHeartbeatSummaryTarget(rawMessage);
}

export function formatHeartbeatErrorHint(rawMessage: string): string {
  return parseHeartbeatDecisionMessage(rawMessage);
}

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

function parseHeartbeatSummaryTarget(rawMessage: string): string {
  const normalized = rawMessage || "";
  if (normalized.includes("agent timeout")) {
    return "模型处理超时，请稍后重试；若持续超时请检查网络或加长 timeout 配置。";
  }
  if (isAuthError(normalized)) {
    return "未检测到可用认证配置，请先执行 `lainclaw auth login openai-codex` 并检查登录信息。";
  }
  return "模型调用失败，请联系管理员查看服务日志；或检查 provider/profile 配置后重试。";
}

function parseHeartbeatDecisionMessage(rawMessage: string): string {
  if (rawMessage.includes("contact:user.employee_id:readonly")) {
    return `${rawMessage}。请在飞书应用后台为应用补充 “联系人-查看员工个人资料-只读（contact:user.employee_id:readonly）” 权限，并重装应用后重试。`;
  }
  if (rawMessage.includes("not a valid") && rawMessage.includes("Invalid ids: [oc_")) {
    return `${rawMessage}。检测到目标 ID 为 oc_ 前缀，通常需要传入用户 open_id（ou_）或可用的 user_id；请确认你配置的是接收人个人 open_id。`;
  }
  return rawMessage;
}

function isAuthError(rawMessage: string): boolean {
  return (
    rawMessage.includes("profile found") ||
    rawMessage.includes("No profile found") ||
    rawMessage.includes("Failed to read OAuth credentials")
  );
}
