import fs from "node:fs/promises";
import path from "node:path";
import { resolveAuthDirectory } from "../auth/configStore.js";

const HEARTBEAT_RULE_FILE = "heartbeat-rules.json";
const CURRENT_VERSION = 1 as const;

interface HeartbeatRuleStorage {
  version: 1;
  rules: Array<{
    id: string;
    ruleText: string;
    enabled: boolean;
    provider?: string;
    profileId?: string;
    withTools?: boolean;
    toolAllow?: string[];
    toolMaxSteps?: number;
    createdAt: string;
    updatedAt: string;
    lastRunAt?: string;
    lastTriggerAt?: string;
    lastStatus?: "skip" | "trigger" | "error";
    lastStatusMessage?: string;
  }>;
}

function resolveHeartbeatRulePath(): string {
  return path.join(resolveAuthDirectory(), HEARTBEAT_RULE_FILE);
}

function sanitizeText(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const text = raw.trim();
  return text.length > 0 ? text : undefined;
}

function sanitizeBoolean(raw: unknown): boolean | undefined {
  if (typeof raw !== "boolean") {
    return undefined;
  }
  return raw;
}

function sanitizeStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const values = raw
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return values.length > 0 ? values : undefined;
}

function sanitizePositiveNumber(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return undefined;
  }
  const n = Math.floor(raw);
  if (n <= 0) {
    return undefined;
  }
  return n;
}

function sanitizeProvider(raw: unknown): string | undefined {
  const provider = sanitizeText(raw)?.toLowerCase();
  if (!provider) {
    return undefined;
  }
  if (provider === "openai-codex") {
    return provider;
  }
  return undefined;
}

function normalizeRule(raw: unknown): Partial<HeartbeatRule> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const candidate = raw as Record<string, unknown>;
  const id = sanitizeText(candidate.id);
  const ruleText = sanitizeText(candidate.ruleText);
  if (!id || !ruleText) {
    return undefined;
  }

  return {
    id,
    ruleText,
    enabled: candidate.enabled === undefined ? true : candidate.enabled === true,
    provider: sanitizeProvider(candidate.provider),
    profileId: sanitizeText(candidate.profileId),
    withTools: sanitizeBoolean(candidate.withTools) ?? false,
    toolAllow: sanitizeStringArray(candidate.toolAllow),
    toolMaxSteps: sanitizePositiveNumber(candidate.toolMaxSteps),
    createdAt: sanitizeText(candidate.createdAt) ?? new Date().toISOString(),
    updatedAt: sanitizeText(candidate.updatedAt) ?? new Date().toISOString(),
    lastRunAt: sanitizeText(candidate.lastRunAt),
    lastTriggerAt: sanitizeText(candidate.lastTriggerAt),
    lastStatus: candidate.lastStatus === "trigger" || candidate.lastStatus === "skip" || candidate.lastStatus === "error"
      ? candidate.lastStatus
      : undefined,
    lastStatusMessage: sanitizeText(candidate.lastStatusMessage),
  };
}

export interface HeartbeatRule {
  id: string;
  ruleText: string;
  enabled: boolean;
  provider?: string;
  profileId?: string;
  withTools: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
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
  toolMaxSteps?: number;
  enabled?: boolean;
}

export function createHeartbeatRuleId(): string {
  return `heartbeat-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
}

export async function loadHeartbeatRules(): Promise<HeartbeatRule[]> {
  const rawPath = resolveHeartbeatRulePath();

  try {
    const raw = await fs.readFile(rawPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<HeartbeatRuleStorage>;
    if (!parsed || typeof parsed !== "object" || parsed.version !== CURRENT_VERSION || !Array.isArray(parsed.rules)) {
      return [];
    }

    const list: HeartbeatRule[] = [];
    for (const candidate of parsed.rules) {
      const normalized = normalizeRule(candidate);
      if (!normalized) {
        continue;
      }
      const {
        id,
        ruleText,
        enabled,
        provider,
        profileId,
        withTools,
        toolAllow,
        toolMaxSteps,
        createdAt,
        updatedAt,
        lastRunAt,
        lastTriggerAt,
        lastStatus,
        lastStatusMessage,
      } = normalized;
      if (!id || !ruleText || typeof enabled !== "boolean") {
        continue;
      }
      list.push({
        id,
        ruleText,
        enabled,
        ...(provider ? { provider } : {}),
        ...(profileId ? { profileId } : {}),
        withTools,
        ...(toolAllow ? { toolAllow } : {}),
        ...(toolMaxSteps ? { toolMaxSteps } : {}),
        createdAt,
        updatedAt,
        ...(lastRunAt ? { lastRunAt } : {}),
        ...(lastTriggerAt ? { lastTriggerAt } : {}),
        ...(lastStatus ? { lastStatus } : {}),
        ...(lastStatusMessage ? { lastStatusMessage } : {}),
      });
    }
    return list;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function saveHeartbeatRules(rules: HeartbeatRule[]): Promise<void> {
  const rawPath = resolveHeartbeatRulePath();
  const nowIso = new Date().toISOString();

  const storage: HeartbeatRuleStorage = {
    version: CURRENT_VERSION,
    rules: rules.map((rule) => ({
      id: rule.id,
      ruleText: rule.ruleText,
      enabled: rule.enabled,
      ...(rule.provider ? { provider: rule.provider } : {}),
      ...(rule.profileId ? { profileId: rule.profileId } : {}),
      ...(typeof rule.withTools === "boolean" ? { withTools: rule.withTools } : {}),
      ...(Array.isArray(rule.toolAllow) && rule.toolAllow.length > 0 ? { toolAllow: rule.toolAllow } : {}),
      ...(typeof rule.toolMaxSteps === "number" ? { toolMaxSteps: rule.toolMaxSteps } : {}),
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt || nowIso,
      ...(rule.lastRunAt ? { lastRunAt: rule.lastRunAt } : {}),
      ...(rule.lastTriggerAt ? { lastTriggerAt: rule.lastTriggerAt } : {}),
      ...(rule.lastStatus ? { lastStatus: rule.lastStatus } : {}),
      ...(rule.lastStatusMessage ? { lastStatusMessage: rule.lastStatusMessage } : {}),
    })),
  };
  await fs.mkdir(resolveAuthDirectory(), { recursive: true });
  const tmpPath = `${rawPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(storage, null, 2), "utf-8");
  await fs.rename(tmpPath, rawPath);
}

function cloneRule(rule: HeartbeatRule): HeartbeatRule {
  return {
    ...rule,
    ...(Array.isArray(rule.toolAllow) ? { toolAllow: [...rule.toolAllow] } : {}),
  };
}

export async function findHeartbeatRule(ruleId: string): Promise<HeartbeatRule | undefined> {
  const rules = await loadHeartbeatRules();
  return rules.find((rule) => rule.id === ruleId);
}

export async function addHeartbeatRule(input: NewHeartbeatRule): Promise<HeartbeatRule> {
  const rule = buildHeartbeatRule(input);
  const rules = await loadHeartbeatRules();
  await saveHeartbeatRules([rule, ...rules]);
  return rule;
}

export async function removeHeartbeatRule(ruleId: string): Promise<boolean> {
  const rules = await loadHeartbeatRules();
  const next = rules.filter((rule) => rule.id !== ruleId);
  if (next.length === rules.length) {
    return false;
  }
  await saveHeartbeatRules(next);
  return true;
}

export async function setHeartbeatRuleEnabled(ruleId: string, enabled: boolean): Promise<boolean> {
  const rules = await loadHeartbeatRules();
  let updated = false;

  const next = rules.map((rule) => {
    if (rule.id !== ruleId) {
      return rule;
    }

    updated = true;
    return {
      ...rule,
      enabled,
      updatedAt: new Date().toISOString(),
    };
  });

  if (!updated) {
    return false;
  }

  await saveHeartbeatRules(next);
  return true;
}

export async function listHeartbeatRules(): Promise<HeartbeatRule[]> {
  const rules = await loadHeartbeatRules();
  return rules.map(cloneRule);
}

export function buildHeartbeatRule(input: NewHeartbeatRule): HeartbeatRule {
  const ruleText = sanitizeText(input.ruleText) ?? "";
  if (!ruleText) {
    throw new Error("Heartbeat rule text cannot be empty.");
  }
  const provider = sanitizeProvider(input.provider);
  const withTools = sanitizeBoolean(input.withTools) ?? false;
  const toolAllow = sanitizeStringArray(input.toolAllow);
  const toolMaxSteps = sanitizePositiveNumber(input.toolMaxSteps);
  const profileId = sanitizeText(input.profileId);
  const now = new Date().toISOString();
  return {
    id: createHeartbeatRuleId(),
    ruleText,
    enabled: input.enabled ?? true,
    ...(provider ? { provider } : {}),
    ...(profileId ? { profileId } : {}),
    withTools,
    ...(toolAllow ? { toolAllow } : {}),
    ...(toolMaxSteps ? { toolMaxSteps } : {}),
    createdAt: now,
    updatedAt: now,
  };
}
