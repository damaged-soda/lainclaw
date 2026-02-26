import path from "node:path";
import { resolveAuthDirectory } from "../auth/configStore.js";

export interface GatewayServiceState {
  channel: string;
  channels?: string[];
  pid: number;
  startedAt: string;
  command: string;
  statePath: string;
  logPath: string;
  argv: string[];
}

export interface GatewayServicePaths {
  statePath: string;
  logPath: string;
}

export interface GatewayServiceTerminateOptions {
  gracefulTimeoutMs?: number;
  forceKillTimeoutMs?: number;
}

const DEFAULT_STATE_FILE_SUFFIX = ".json";
const DEFAULT_LOG_FILE_SUFFIX = ".log";
const DEFAULT_GATEWAY_SERVICE_BASENAME = "gateway-service";
const DEFAULT_GATEWAY_CHANNEL = "gateway";

function normalizeGatewayChannel(rawChannel: string): string {
  const normalized = String(rawChannel ?? "").trim().toLowerCase();
  return normalized.length > 0 ? normalized : DEFAULT_GATEWAY_CHANNEL;
}

export function resolveGatewayServicePaths(
  rawChannel: string,
  overrides: Partial<GatewayServicePaths> = {},
): GatewayServicePaths {
  const channel = normalizeGatewayChannel(rawChannel);
  // 当前实现不按 channel 分目录，但保留归一化调用链，便于后续扩展且不影响既有路径语义。
  void channel;
  const serviceDir = path.join(resolveAuthDirectory(), "service");

  return {
    statePath: overrides.statePath
      ? path.resolve(overrides.statePath)
      : path.join(serviceDir, `${DEFAULT_GATEWAY_SERVICE_BASENAME}${DEFAULT_STATE_FILE_SUFFIX}`),
    logPath: overrides.logPath
      ? path.resolve(overrides.logPath)
      : path.join(serviceDir, `${DEFAULT_GATEWAY_SERVICE_BASENAME}${DEFAULT_LOG_FILE_SUFFIX}`),
  };
}
