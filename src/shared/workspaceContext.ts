import fs from "node:fs/promises";
import path from "node:path";
import { resolveAuthDirectory } from "../auth/configStore.js";

const DEFAULT_CONTEXT_UNKNOWN_LIMIT = 12;

export interface WorkspaceContextArtifact {
  name: string;
  role: string;
  exists: boolean;
  isDirectory: boolean;
}

export interface WorkspaceContext {
  workspaceDir: string;
  now: string;
  topFileEntries: WorkspaceContextArtifact[];
  unknownEntries: string[];
  summaryText: string;
}

export const DEFAULT_WORKSPACE_CONTEXT_TOP_FILES = [
  { name: "HEARTBEAT.md", role: "周期任务定义文件" },
  { name: "AGENTS.md", role: "协作约束与权限边界（高优先级）" },
  { name: "README.md", role: "项目说明、使用说明、运行上下文" },
  { name: "gateway.json", role: "网关与心跳参数配置（provider/工具/心跳开关）" },
  { name: "package.json", role: "脚本与依赖配置（确认可执行命令上下文）" },
  { name: "sessions", role: "会话目录（会话上下文与历史）" },
  { name: "memory", role: "长期记忆目录（memory 模式产物）" },
  { name: "src", role: "源码目录（当前实现入口与核心逻辑）" },
  { name: "docs", role: "项目文档与约定说明" },
  { name: "tools", role: "工具/命令定义与能力边界" },
  { name: ".git", role: "代码仓库元数据（变更与历史上下文）" },
] as const;

export interface WorkspaceContextOptions {
  topFiles?: typeof DEFAULT_WORKSPACE_CONTEXT_TOP_FILES;
  unknownEntriesLimit?: number;
}

export function resolveWorkspaceDir(rawWorkspaceDir?: string): string {
  const trimmed = rawWorkspaceDir?.trim() ?? "";
  if (!trimmed) {
    return resolveAuthDirectory();
  }
  return path.resolve(trimmed);
}

async function probeWorkspaceArtifact(
  workspaceDir: string,
  entry: { name: string; role: string },
): Promise<WorkspaceContextArtifact> {
  const fullPath = path.join(workspaceDir, entry.name);
  try {
    const stat = await fs.stat(fullPath);
    return {
      name: entry.name,
      role: entry.role,
      exists: true,
      isDirectory: stat.isDirectory(),
    };
  } catch {
    return {
      name: entry.name,
      role: entry.role,
      exists: false,
      isDirectory: false,
    };
  }
}

export async function inspectWorkspaceContext(
  workspaceDir: string,
  now: string,
  options: WorkspaceContextOptions = {},
): Promise<WorkspaceContext> {
  const topFiles = options.topFiles ?? DEFAULT_WORKSPACE_CONTEXT_TOP_FILES;
  const unknownEntriesLimit = options.unknownEntriesLimit ?? DEFAULT_CONTEXT_UNKNOWN_LIMIT;
  const resolvedWorkspaceDir = resolveWorkspaceDir(workspaceDir);
  const topFileEntries = await Promise.all(
    topFiles.map((entry) => probeWorkspaceArtifact(resolvedWorkspaceDir, entry)),
  );
  const knownNames = new Set(topFiles.map((entry) => entry.name));
  const topLevelEntries = await fs.readdir(resolvedWorkspaceDir, { withFileTypes: true }).catch(() => []);
  const unknownEntries = topLevelEntries
    .map((entry) => entry.name)
    .filter((name) => !knownNames.has(name) && !name.startsWith("."))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, unknownEntriesLimit);

  const lines: string[] = [];
  lines.push(`工作区：${resolvedWorkspaceDir}`);
  lines.push(`当前时间：${now}`);
  lines.push("已识别工作区文件（本次会参考）：");

  const existsEntries = topFileEntries.filter((entry) => entry.exists);
  if (existsEntries.length > 0) {
    for (const entry of existsEntries) {
      lines.push(`- ${entry.name}（${entry.isDirectory ? "目录" : "文件"}）：${entry.role}`);
    }
  } else {
    lines.push("- 未检测到预定义关键文件，按任务文本直接判断");
  }

  if (!existsEntries.some((entry) => entry.name === "HEARTBEAT.md")) {
    lines.push("- 未检测到 HEARTBEAT.md（缺省时仍按规则文本与时间上下文执行）");
  }

  return {
    workspaceDir: resolvedWorkspaceDir,
    now,
    topFileEntries,
    unknownEntries,
    summaryText: lines.join("\n"),
  };
}

function buildWorkspaceGuidance(context: WorkspaceContext): string[] {
  const heartbeatPath = path.join(context.workspaceDir, "HEARTBEAT.md");
  const lines = [
    "运行约定（请严格遵守）：",
    "- 你当前交互的工作区是 Lainclaw 运行目录，不是业务源码目录。",
    `- 当前会用于模型决策的 HEARTBEAT 文件是：${heartbeatPath}`,
    "- 若需要新增/调整定期检查任务，优先用 `lainclaw heartbeat init`（首次）和 `lainclaw heartbeat add \"<rule>\"`。",
    "- 你也可直接编辑 `HEARTBEAT.md`：一行一条，如 `- 检查邮件` 或 `- [ ] 某任务`（未勾选表示禁用）。",
  ];

  if (!context.topFileEntries.some((entry) => entry.name === "HEARTBEAT.md" && entry.exists)) {
    lines.push("- 当前工作区未检测到 HEARTBEAT.md，先提示用户执行 `heartbeat init` 后再进行规则管理。");
  }

  return lines;
}

export function formatWorkspaceContextSummary(context: WorkspaceContext): string {
  return `${context.summaryText}\n${buildWorkspaceGuidance(context).join("\n")}`;
}

export function buildAgentSystemPrompt(context: WorkspaceContext, basePrompt = "You are a concise and reliable coding assistant."): string {
  return `${basePrompt}\n\n${formatWorkspaceContextSummary(context)}`;
}
