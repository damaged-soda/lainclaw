import { setTimeout as delay } from "node:timers/promises";
import { type FeishuGatewayConfig } from "./config.js";

interface FeishuTokenResponse {
  code?: number;
  msg?: string;
  app_access_token?: string;
  data?: {
    app_access_token?: string;
    expire?: number;
  };
  expire?: number;
}

interface FeishuMessageResponse {
  code?: number;
  msg?: string;
}

interface FeishuTokenState {
  token: string;
  expiredAt: number;
}

const APP_ACCESS_TOKEN_ENDPOINT = "https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal";
const SEND_MESSAGE_ENDPOINT = "https://open.feishu.cn/open-apis/im/v1/messages";
const DEFAULT_EXPIRE_BUFFER_SECONDS = 300;
const FALLBACK_TOKEN_CACHE_SECONDS = 3600;
const FEISHU_TEXT_MESSAGE_TYPE = "text";

function toNumber(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function parseFeishuCode(payload: FeishuTokenResponse | FeishuMessageResponse | null): number {
  if (!payload || typeof (payload as FeishuTokenResponse).code !== "number") {
    return 0;
  }
  return (payload as FeishuTokenResponse).code as number;
}

function parseFeishuMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  if ("msg" in payload) {
    const msg = payload.msg;
    if (typeof msg === "string") {
      return msg;
    }
  }
  return "";
}

function resolveReceiveIdType(rawOpenId: string): "open_id" | "user_id" {
  if (rawOpenId.startsWith("ou_")) {
    return "open_id";
  }
  return "user_id";
}

function nowUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function parseErrorPayload(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    const msg = parseFeishuMessage(parsed);
    if (msg) {
      return msg;
    }
  } catch {
    // ignore parse errors.
  }
  return raw;
}

async function requestJson(url: string, options: RequestInit, timeoutMs: number): Promise<unknown> {
  const response = await Promise.race([
    fetch(url, options),
    delay(timeoutMs).then(() => {
      throw new Error(`feishu request timeout after ${timeoutMs}ms`);
    }),
  ]);
  return response.json();
}

let tokenCache: FeishuTokenState | null = null;

async function resolveAccessToken(config: FeishuGatewayConfig): Promise<string> {
  if (!config.appId || !config.appSecret) {
    throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET for access token retrieval");
  }

  const nowSeconds = nowUnixSeconds();
  if (tokenCache && tokenCache.expiredAt > nowSeconds + 1) {
    return tokenCache.token;
  }

  const response = await requestJson(
    APP_ACCESS_TOKEN_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app_id: config.appId,
        app_secret: config.appSecret,
      }),
    },
    config.requestTimeoutMs,
  );
  const parsed = (response || null) as FeishuTokenResponse | null;
  const code = parseFeishuCode(parsed);
  if (code !== 0) {
    const msg = parseFeishuMessage(response);
    throw new Error(`Feishu token request failed (${code || "unknown"}): ${msg || "empty message"}`);
  }

  const resolvedToken =
    (parsed?.app_access_token || parsed?.data?.app_access_token || "").trim();
  if (!resolvedToken) {
    throw new Error("Feishu token response missing app_access_token");
  }
  const tokenTTL = toNumber(parsed?.expire) || toNumber(parsed?.data?.expire) || FALLBACK_TOKEN_CACHE_SECONDS;
  const expiresIn = Math.max(60, tokenTTL - DEFAULT_EXPIRE_BUFFER_SECONDS);
  tokenCache = {
    token: resolvedToken,
    expiredAt: nowSeconds + expiresIn,
  };
  return resolvedToken;
}

export async function sendFeishuTextMessage(rawConfig: Partial<FeishuGatewayConfig>, input: {
  openId: string;
  text: string;
}): Promise<void> {
  const DEFAULT_PROVIDER = "openai-codex";
  const DEFAULT_WITH_TOOLS = true;
  const DEFAULT_MEMORY = false;
  const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
  const config: FeishuGatewayConfig = {
    requestTimeoutMs: rawConfig.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    provider: typeof rawConfig.provider === "string" && rawConfig.provider.trim() ? rawConfig.provider.trim() : DEFAULT_PROVIDER,
    withTools: rawConfig.withTools ?? DEFAULT_WITH_TOOLS,
    memory: rawConfig.memory ?? DEFAULT_MEMORY,
    ...(typeof rawConfig.appId === "string" && rawConfig.appId.trim() ? { appId: rawConfig.appId.trim() } : {}),
    ...(typeof rawConfig.appSecret === "string" && rawConfig.appSecret.trim() ? { appSecret: rawConfig.appSecret.trim() } : {}),
  };
  if (!input.openId || !input.text.trim()) {
    return;
  }

  const token = await resolveAccessToken(config);
  const receiveIdType = resolveReceiveIdType(input.openId);
  const sendMessageUrl = new URL(SEND_MESSAGE_ENDPOINT);
  sendMessageUrl.searchParams.set("receive_id_type", receiveIdType);
  const response = await requestJson(
    sendMessageUrl.toString(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: input.openId,
        msg_type: FEISHU_TEXT_MESSAGE_TYPE,
        content: JSON.stringify({
          text: input.text,
        }),
      }),
    },
    config.requestTimeoutMs,
  );
  const parsed = (response || null) as FeishuMessageResponse | null;
  const code = parseFeishuCode(parsed);
  if (code !== 0) {
    const message = parseFeishuMessage(response);
    throw new Error(`Feishu send message failed (${code || "unknown"}): ${message || "empty message"}`);
  }
}

export function resetFeishuTokenCache(): void {
  tokenCache = null;
}
