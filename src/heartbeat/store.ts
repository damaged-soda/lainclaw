import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkspaceDir } from "../shared/workspaceContext.js";

const HEARTBEAT_RULE_FILE = "HEARTBEAT.md";
const HEARTBEAT_TEMPLATE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "template",
  HEARTBEAT_RULE_FILE,
);

const HEARTBEAT_MARKER_TASK = /^(?<indent>\s*)(?<marker>[-*+])(?:\s*\[(?<done>[xX\s])\]\s*)?(?<text>.+)$/;
const HEARTBEAT_MARKER_ORDERED = /^\s*\d+[.)]\s+(?<text>.+)$/;

const HEARTBEAT_TASK_TEMPLATE =
  "# HEARTBEAT.md\n" +
  "# Keep this file empty (or with only comments) to skip heartbeat API calls.\n" +
  "\n" +
  "# Add tasks below when you want the agent to check something periodically.\n";

export interface HeartbeatRule {
  id: string;
  ruleText: string;
  enabled: boolean;
  provider?: string;
  profileId?: string;
  withTools: boolean;
  toolAllow?: string[];
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastTriggerAt?: string;
  lastStatus?: "skip" | "trigger" | "error";
  lastStatusMessage?: string;
}

export interface NewHeartbeatRule {
  ruleText: string;
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  toolAllow?: string[];
  enabled?: boolean;
}

interface ParsedHeartbeatTask {
  id: string;
  ruleText: string;
  enabled: boolean;
  lineNo: number;
  rawLine: string;
}

interface ParsedFile {
  tasks: ParsedHeartbeatTask[];
  lines: string[];
}

function resolveHeartbeatRulePath(workspaceDir?: string): string {
  const workspace = resolveWorkspaceDir(workspaceDir);
  return path.join(path.resolve(workspace), HEARTBEAT_RULE_FILE);
}

function resolveHeartbeatTemplatePath(rawTemplatePath?: string): string {
  if (!rawTemplatePath?.trim()) {
    return HEARTBEAT_TEMPLATE_PATH;
  }
  return path.resolve(rawTemplatePath);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch (error) {
    const anyErr = error as { code?: string };
    if (anyErr.code === "ENOENT" || anyErr.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const text = raw.trim();
  return text.length > 0 ? text : undefined;
}

function normalizeStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const values = raw
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return values.length > 0 ? values : undefined;
}

function normalizeProvider(raw: unknown): string | undefined {
  const provider = normalizeText(raw)?.toLowerCase();
  if (!provider) {
    return undefined;
  }
  if (provider === "openai-codex") {
    return provider;
  }
  return undefined;
}

function normalizeBoolean(raw: unknown): boolean | undefined {
  if (typeof raw !== "boolean") {
    return undefined;
  }
  return raw;
}

function hashTaskId(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = (hash * 16_777_619) >>> 0;
  }
  return `hb-${hash.toString(36)}`;
}

function parseHeartbeatTasks(content: string): ParsedHeartbeatTask[] {
  const tasks: ParsedHeartbeatTask[] = [];

  const lines = content.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("#")) {
      continue;
    }

    const matchTask = trimmed.match(HEARTBEAT_MARKER_TASK);
    if (matchTask?.groups) {
      const text = normalizeText(matchTask.groups.text);
      if (!text) {
        continue;
      }
      const done = matchTask.groups.done;
      const hasCheckbox = typeof done === "string";
      const enabled = !hasCheckbox || done?.toLowerCase() === "x";
      const id = hashTaskId(`${index}-${text}`);
      tasks.push({ id, ruleText: text, enabled, lineNo: index, rawLine });
      continue;
    }

    const matchOrdered = trimmed.match(HEARTBEAT_MARKER_ORDERED);
    if (matchOrdered?.groups) {
      const text = normalizeText(matchOrdered.groups.text);
      if (!text) {
        continue;
      }
      tasks.push({
        id: hashTaskId(`${index}-${text}`),
        ruleText: text,
        enabled: true,
        lineNo: index,
        rawLine,
      });
    }
  }

  return tasks;
}

async function readHeartbeatFile(rawPath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(rawPath, "utf-8");
  } catch (error) {
    const anyErr = error as { code?: string };
    if (anyErr.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function loadHeartbeatFile(workspaceDir?: string): Promise<ParsedFile> {
  const heartbeatPath = resolveHeartbeatRulePath(workspaceDir);
  const content = await readHeartbeatFile(heartbeatPath);
  const lines = typeof content === "string" ? content.split(/\r?\n/) : [];
  return {
    tasks: parseHeartbeatTasks(content ?? ""),
    lines,
  };
}

function asRule(task: ParsedHeartbeatTask, now = nowIso()): HeartbeatRule {
  return {
    id: task.id,
    ruleText: task.ruleText,
    enabled: task.enabled,
    withTools: false,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeTaskLine(rawLine: string, enabled: boolean, ruleText: string): string {
  const trimmed = rawLine.trim();
  const markerMatch = trimmed.match(/^([*-+])/);
  const marker = markerMatch?.[1] ?? "-";
  const indent = rawLine.match(/^\s*/)?.[0] ?? "";

  const base = `${indent}${marker} `;
  return enabled ? `${base}${ruleText}` : `${base}[ ] ${ruleText}`;
}

interface HeartbeatTemplateInitOptions {
  workspaceDir?: string;
  templatePath?: string;
  overwrite?: boolean;
}

export interface HeartbeatTemplateInitResult {
  status: "created" | "updated" | "skipped";
  targetPath: string;
  templatePath: string;
}

async function loadHeartbeatTemplate(rawTemplatePath?: string): Promise<{ templatePath: string; content: string }> {
  const templatePath = resolveHeartbeatTemplatePath(rawTemplatePath);
  try {
    const content = await fs.readFile(templatePath, "utf-8");
    return { templatePath, content };
  } catch (error) {
    const anyErr = error as { code?: string };
    if (anyErr.code === "ENOENT" && templatePath === HEARTBEAT_TEMPLATE_PATH) {
      return {
        templatePath,
        content: HEARTBEAT_TASK_TEMPLATE,
      };
    }
    if (anyErr.code === "ENOENT") {
      throw new Error(`Heartbeat template not found: ${templatePath}`);
    }
    if (anyErr.code === "ENOTDIR") {
      throw new Error(`Invalid heartbeat template path: ${templatePath}`);
    }
    throw error;
  }
}

export async function initHeartbeatFile(
  options: HeartbeatTemplateInitOptions = {},
): Promise<HeartbeatTemplateInitResult> {
  const workspaceDir = resolveWorkspaceDir(options.workspaceDir);
  const targetPath = resolveHeartbeatRulePath(workspaceDir);
  const { templatePath, content } = await loadHeartbeatTemplate(options.templatePath);
  const exists = await fileExists(targetPath);

  if (exists && !options.overwrite) {
    return {
      status: "skipped",
      targetPath,
      templatePath,
    };
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf-8");
  return {
    status: exists ? "updated" : "created",
    targetPath,
    templatePath,
  };
}

export function createHeartbeatRuleId(): string {
  return `heartbeat-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
}

export async function loadHeartbeatRules(workspaceDir?: string): Promise<HeartbeatRule[]> {
  const now = nowIso();
  const parsed = await loadHeartbeatFile(workspaceDir);
  return parsed.tasks.map((task) => asRule(task, now));
}

export async function saveHeartbeatRules(rules: HeartbeatRule[], workspaceDir?: string): Promise<void> {
  const heartbeatPath = resolveHeartbeatRulePath(workspaceDir);
  const existingRaw = await loadHeartbeatFile(workspaceDir);
  const lines = existingRaw.lines;
  const byId = new Map<string, HeartbeatRule>(rules.map((rule) => [rule.id, rule]));

  const updated = lines
    .map((line, index) => {
      const task = existingRaw.tasks.find((entry) => entry.lineNo === index);
      if (!task) {
        return line;
      }
      const next = byId.get(task.id);
      if (!next) {
        return line;
      }
      return normalizeTaskLine(task.rawLine, next.enabled, next.ruleText);
    })
    .join("\n");

  await fs.writeFile(heartbeatPath, `${updated}\n`, "utf-8");
}

export function buildHeartbeatRule(input: NewHeartbeatRule): HeartbeatRule {
  const ruleText = normalizeText(input.ruleText) ?? "";
  if (!ruleText) {
    throw new Error("Heartbeat rule text cannot be empty.");
  }
  const withTools = normalizeBoolean(input.withTools) ?? false;
  const toolAllow = normalizeStringArray(input.toolAllow);
  const profileId = normalizeText(input.profileId);
  const provider = normalizeProvider(input.provider);
  const now = nowIso();
  return {
    id: createHeartbeatRuleId(),
    ruleText,
    enabled: input.enabled ?? true,
    ...(provider ? { provider } : {}),
    ...(profileId ? { profileId } : {}),
    withTools,
    ...(toolAllow ? { toolAllow } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

export async function addHeartbeatRule(
  input: NewHeartbeatRule,
  workspaceDir?: string,
): Promise<HeartbeatRule> {
  const rule = buildHeartbeatRule(input);
  const heartbeatPath = resolveHeartbeatRulePath(workspaceDir);
  await fs.mkdir(path.dirname(heartbeatPath), { recursive: true });

  const existing = await readHeartbeatFile(heartbeatPath);
  const normalized = existing ?? HEARTBEAT_TASK_TEMPLATE;
  const marker = rule.enabled ? `- ${rule.ruleText}` : `- [ ] ${rule.ruleText}`;
  const connector = normalized.endsWith("\n") || normalized.length === 0 ? "" : "\n";
  await fs.appendFile(heartbeatPath, `${connector}${marker}\n`, "utf-8");
  return rule;
}

export async function removeHeartbeatRule(ruleId: string, workspaceDir?: string): Promise<boolean> {
  const parsed = await loadHeartbeatFile(workspaceDir);
  const target = parsed.tasks.find((task) => task.id === ruleId);
  if (!target) {
    return false;
  }

  const nextLines = parsed.lines.filter((_line, index) => index !== target.lineNo);
  const heartbeatPath = resolveHeartbeatRulePath(workspaceDir);
  await fs.writeFile(heartbeatPath, `${nextLines.join("\n")}${nextLines.length > 0 ? "\n" : ""}`, "utf-8");
  return true;
}

export async function setHeartbeatRuleEnabled(ruleId: string, enabled: boolean, workspaceDir?: string): Promise<boolean> {
  const parsed = await loadHeartbeatFile(workspaceDir);
  const target = parsed.tasks.find((task) => task.id === ruleId);
  if (!target) {
    return false;
  }

  const nextLines = [...parsed.lines];
  nextLines[target.lineNo] = normalizeTaskLine(target.rawLine, enabled, target.ruleText);

  const heartbeatPath = resolveHeartbeatRulePath(workspaceDir);
  await fs.writeFile(heartbeatPath, `${nextLines.join("\n")}\n`, "utf-8");
  return true;
}

export async function listHeartbeatRules(workspaceDir?: string): Promise<HeartbeatRule[]> {
  return await loadHeartbeatRules(workspaceDir);
}
