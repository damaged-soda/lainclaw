export function makeFeishuRequestFailureHint(rawMessage: string): string {
  if (isAuthError(rawMessage || "")) {
    return "未检测到可用认证配置，请先执行 `lainclaw auth login openai-codex` 并检查登录信息。";
  }
  return "处理时间较长或执行异常中断，请稍后重试。";
}

function isAuthError(rawMessage: string): boolean {
  return (
    rawMessage.includes("profile found") ||
    rawMessage.includes("No profile found") ||
    rawMessage.includes("Failed to read OAuth credentials")
  );
}
