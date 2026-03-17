import type { PathDefinition } from "./contracts.js";

export const PATH_DEFS = {
  workspace: {
    rel: "workspace",
    kind: "directory",
    visibility: "visible",
    ops: ["read", "write", "edit", "apply_patch", "exec", "list_dir", "glob"],
    purpose: "agent 默认工作目录",
  },
  memory: {
    rel: "memory",
    kind: "directory",
    visibility: "visible",
    ops: ["read", "write", "edit", "list_dir", "glob"],
    purpose: "长期记忆和人工沉淀",
  },
  heartbeat: {
    rel: "HEARTBEAT.md",
    kind: "file",
    visibility: "hidden",
    ops: [],
    purpose: "heartbeat runner 消费的任务文件",
  },
  authProfiles: {
    rel: "auth-profiles.json",
    kind: "file",
    visibility: "hidden",
    ops: [],
    purpose: "provider 凭据配置",
  },
  gatewayConfig: {
    rel: "gateway.json",
    kind: "file",
    visibility: "hidden",
    ops: [],
    purpose: "gateway 默认运行配置",
  },
  sessions: {
    rel: "sessions",
    kind: "directory",
    visibility: "hidden",
    ops: [],
    purpose: "session transcript 和索引",
  },
  agentState: {
    rel: "agent-state",
    kind: "directory",
    visibility: "hidden",
    ops: [],
    purpose: "provider 运行态快照",
  },
  service: {
    rel: "service",
    kind: "directory",
    visibility: "hidden",
    ops: [],
    purpose: "gateway service state 和日志",
  },
  feishuPairing: {
    rel: "feishu-pairing.json",
    kind: "file",
    visibility: "hidden",
    ops: [],
    purpose: "飞书 pairing 状态",
  },
  localGateway: {
    rel: "local-gateway",
    kind: "directory",
    visibility: "hidden",
    ops: [],
    purpose: "local channel inbox/outbox",
  },
} as const satisfies Record<string, PathDefinition>;

export type PathKey = keyof typeof PATH_DEFS;
