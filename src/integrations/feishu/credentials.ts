import { resolveFeishuGatewayConfigPath } from "./config.js";

export function validateFeishuGatewayCredentials(config: { appId?: string; appSecret?: string }): void {
  const configPath = resolveFeishuGatewayConfigPath("feishu");
  if (!config.appId || !config.appSecret) {
    throw new Error(
      "Missing FEISHU_APP_ID or FEISHU_APP_SECRET for websocket mode. "
      + "请执行 `lainclaw gateway start --app-id <真实AppID> --app-secret <真实AppSecret>` "
      + `或清理当前频道网关缓存后重试：` + "`rm " + `${configPath}` + "`。",
    );
  }

  if (isPlaceholderLikely(config.appId) || isPlaceholderLikely(config.appSecret)) {
    throw new Error(
      `Detected invalid/placeholder Feishu credentials (appId=${maskCredential(config.appId)}, `
      + `appSecret=${maskCredential(config.appSecret)}). `
      + "请确认使用真实飞书应用凭据，再清理当前频道网关缓存并重启 gateway。"
      + `（路径：${configPath}）`,
    );
  }
}

function isPlaceholderLikely(value: string | undefined): boolean {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed.length < 6) {
    return true;
  }
  if (/^\d+$/.test(trimmed)) {
    return true;
  }
  if (/^(test|demo|fake|dummy|sample|example|placeholder|abc|aaa|xxx)+$/i.test(trimmed)) {
    return true;
  }
  return false;
}

function maskCredential(value: string | undefined): string {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return "<empty>";
  }
  if (trimmed.length <= 6) {
    return "*".repeat(trimmed.length);
  }
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-3)}`;
}

