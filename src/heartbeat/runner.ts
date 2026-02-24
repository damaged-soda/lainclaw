import fs from "node:fs/promises";
import path from "node:path";
import { runAgent } from '../gateway/gateway.js';
import {
  type HeartbeatRule,
  loadHeartbeatRules,
  saveHeartbeatRules,
} from './store.js';
import { resolveAuthDirectory } from "../auth/configStore.js";
import {
  formatWorkspaceContextSummary,
  inspectWorkspaceContext,
  resolveWorkspaceDir,
} from "../shared/workspaceContext.js";

const DEFAULT_HEARTBEAT_SESSION_KEY = 'heartbeat';
const HEARTBEAT_LOG_FILE = "heartbeat-run.log";
const DECISION_LINE_RE = /^\s*(TRIGGER|SKIP)\s*[:：]\s*(.*)\s*$/i;
const DECISION_ANY_LINE_RE = /(?:^|[\r\n])\s*(TRIGGER|SKIP)\s*[:：]\s*([^\r\n]*)/i;

export interface HeartbeatRuleDecision {
  decision: 'trigger' | 'skip' | 'error';
  message: string;
  raw: string;
  parseError?: string;
}

export interface HeartbeatRunResult {
  ruleId: string;
  ruleText: string;
  timestamp: string;
  status: 'triggered' | 'skipped' | 'errored';
  decision: 'trigger' | 'skip' | 'error';
  decisionRaw: string;
  message?: string;
  reason?: string;
}

export interface HeartbeatRunSummary {
  ranAt: string;
  total: number;
  evaluated: number;
  triggered: number;
  skipped: number;
  errors: number;
  results: HeartbeatRunResult[];
}

interface HeartbeatRunLogEntry {
  eventType: "run-summary" | "rule-result" | "rule-error";
  runId: string;
  timestamp: string;
  ruleId?: string;
  ruleText?: string;
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
  rawDecision?: string;
  parsedDecision?: HeartbeatRuleDecision["decision"];
  parseError?: string;
  status?: HeartbeatRunResult["status"];
  reason?: string;
  message?: string;
  sessionKey?: string;
  runSessionKey?: string;
}

export interface HeartbeatRunOptions {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
  sessionKey?: string;
  workspaceDir?: string;
  memory?: boolean;
  onSummary?: (summary: HeartbeatRunSummary) => void;
  onResult?: (result: HeartbeatRunResult) => void;
  send?: (payload: {
    rule: HeartbeatRule;
    triggerMessage: string;
    now: string;
    rawDecision: string;
  }) => Promise<void> | void;
}

export interface HeartbeatLoopOptions extends HeartbeatRunOptions {
  intervalMs: number;
}

export interface HeartbeatLoopHandle {
  stop: () => void;
  runOnce: () => Promise<HeartbeatRunSummary>;
}

function getHeartbeatLogPath(): string {
  return path.join(resolveAuthDirectory(), HEARTBEAT_LOG_FILE);
}

function resolveLogPayloadLimit(raw: string, max = 2400): string {
  if (raw.length <= max) {
    return raw;
  }
  return `${raw.slice(0, max)}...`;
}

async function appendHeartbeatLog(entry: HeartbeatRunLogEntry): Promise<void> {
  const payload = JSON.stringify(entry, null, 0);
  try {
    const dir = resolveAuthDirectory();
    const file = getHeartbeatLogPath();
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(file, `${payload}\n`, { encoding: "utf-8" });
  } catch {
    // Heartbeat logging should never block execution.
  }
}

function toIso(now: number) {
  return new Date(now).toISOString();
}

function parseDecision(raw: string): HeartbeatRuleDecision {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) {
    return {
      decision: 'error',
      message: '',
      raw: trimmed,
      parseError: 'Empty model result',
    };
  }

  const normalized = trimmed
    .replace(/```(?:json)?\n?/gi, "")
    .replace(/```/g, "")
    .trim();
  const normalizedLines = normalized.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);

  for (const line of normalizedLines) {
    const match = line.match(DECISION_LINE_RE);
    if (match) {
      const directive = match[1]?.toLowerCase();
      const message = (match[2] ?? "").trim();
      if (directive === "trigger") {
        return {
          decision: "trigger",
          message,
          raw: match[0] || normalized,
        };
      }

      if (directive === "skip") {
        return {
          decision: "skip",
          message,
          raw: match[0] || normalized,
        };
      }
    }
  }

  const anyLineMatch = normalized.match(DECISION_ANY_LINE_RE);
  if (anyLineMatch) {
    const directive = anyLineMatch[1]?.toLowerCase();
    const message = (anyLineMatch[2] ?? "").trim();
    if (directive === "trigger") {
      return {
        decision: "trigger",
        message,
        raw: anyLineMatch[0],
      };
    }
    if (directive === "skip") {
      return {
        decision: "skip",
        message,
        raw: anyLineMatch[0],
      };
    }
  }

  if (normalized.startsWith("{") && normalized.endsWith("}")) {
    try {
      const parsed = JSON.parse(normalized) as Record<string, unknown>;
      const decisionRaw = typeof parsed.decision === "string" ? parsed.decision.toLowerCase() : undefined;
      const messageRaw =
        typeof parsed.message === "string"
          ? parsed.message
          : typeof parsed.reason === "string"
            ? parsed.reason
            : "";
      if (decisionRaw === "trigger") {
        return {
          decision: "trigger",
          message: messageRaw,
          raw: trimmed,
        };
      }
      if (decisionRaw === "skip") {
        return {
          decision: "skip",
          message: messageRaw,
          raw: trimmed,
        };
      }
    } catch {
      // Ignore JSON parse error in decision parsing stage.
    }
  }

  const match = normalized.match(/^(?:\s*[-*]?\s*)?(trigger|skip)\s*[:：]\s*(.*?)\s*$/i);
  if (match) {
    const directive = match[1]?.toLowerCase();
    const message = (match[2] ?? "").trim();
    if (directive === "trigger") {
      return {
        decision: "trigger",
        message,
        raw: match[0],
      };
    }
    if (directive === "skip") {
      return {
        decision: "skip",
        message,
        raw: match[0],
      };
    }
  }

  const normalizedLower = normalized.toLowerCase();
  if (normalizedLower.includes("trigger") && !normalizedLower.includes("skip")) {
    return {
      decision: "trigger",
      message: normalized.slice(0, 600),
      raw: trimmed,
      parseError: "Decision token inferred",
    };
  }

  if (normalizedLower.includes("skip") && !normalizedLower.includes("trigger")) {
    return {
      decision: "skip",
      message: normalized.slice(0, 600),
      raw: trimmed,
      parseError: "Decision token inferred",
    };
  }

  if (!match) {
    return {
      decision: 'error',
      message: trimmed.slice(0, 600),
      raw: trimmed,
      parseError: 'Decision format invalid',
    };
  }

  return {
    decision: 'error',
    message: trimmed.slice(0, 600),
    raw: trimmed,
    parseError: 'Decision token not recognized',
  };
}

function buildRulePrompt(rule: HeartbeatRule, now: string, workspaceSummary: string): string {
  const title = `RuleId: ${rule.id}`;
  const header = '你是一个只用于判断个人提醒触发的裁决器。';
  const constraints = [
    '请只输出一行且仅以下两种之一：',
    'TRIGGER: <触发文案>',
    'SKIP: <不触发原因>',
    '推荐输出 JSON 格式：{"decision":"TRIGGER","message":"..."} 或 {"decision":"SKIP","message":"..."}。',
    `当前时间：${now}`,
    title,
    `规则：${rule.ruleText}`,
    "工作区上下文：",
    workspaceSummary,
    '如果当前时机满足提醒需求，必须返回 TRIGGER；否则返回 SKIP。',
    '不要输出 markdown、序号、说明文本。',
  ];

  return `${header}\n${constraints.join('\n')}\n`; 
}

function resolveRuleDecisionContext(rule: HeartbeatRule, now: string): {
  sessionKey: string;
  provider?: string;
  profileId?: string;
  withTools: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
} {
  return {
    sessionKey: `${rule.id}`,
    provider: rule.provider,
    profileId: rule.profileId,
    withTools: rule.withTools,
    toolAllow: rule.toolAllow,
    toolMaxSteps: rule.toolMaxSteps,
  };
}

function resolveText(raw?: string): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function runHeartbeatOnce(options: HeartbeatRunOptions = {}): Promise<HeartbeatRunSummary> {
  const now = toIso(Date.now());
  const runId = `hb-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
  const workspaceDir = resolveWorkspaceDir(options.workspaceDir);
  const rules = await loadHeartbeatRules(workspaceDir);
  const baseSessionKey = resolveText(options.sessionKey) || DEFAULT_HEARTBEAT_SESSION_KEY;
  const runContext = await inspectWorkspaceContext(workspaceDir, now);

  const summary: HeartbeatRunSummary = {
    ranAt: now,
    total: rules.length,
    evaluated: 0,
    triggered: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };

  const nextRules = rules.map((rule) => ({ ...rule }));

  for (const rule of nextRules) {
    if (!rule.enabled) {
      summary.skipped += 1;
      const skippedResult: HeartbeatRunResult = {
        ruleId: rule.id,
        ruleText: rule.ruleText,
        timestamp: now,
        status: 'skipped',
        decision: 'skip',
        decisionRaw: 'SKIP: disabled',
        reason: 'disabled',
      };
      summary.results.push(skippedResult);
      void appendHeartbeatLog({
        eventType: "rule-result",
        runId,
        timestamp: now,
        ruleId: rule.id,
        ruleText: rule.ruleText,
        provider: resolveText(options.provider) || rule.provider,
        profileId: resolveText(options.profileId) || rule.profileId,
        withTools: typeof options.withTools === "boolean" ? options.withTools : rule.withTools,
        toolAllow: options.toolAllow,
        toolMaxSteps: options.toolMaxSteps,
        parsedDecision: "skip",
        status: skippedResult.status,
        reason: skippedResult.reason,
        message: skippedResult.message,
        sessionKey: baseSessionKey,
      });
      options.onResult?.(skippedResult);
      continue;
    }

    summary.evaluated += 1;
    const decisionPrompt = buildRulePrompt(rule, now, formatWorkspaceContextSummary(runContext));
    const ruleCtx = resolveRuleDecisionContext(rule, now);
    try {
      const agentResult = await runAgent(decisionPrompt, {
        sessionKey: `${baseSessionKey}:${ruleCtx.sessionKey}`,
        provider: resolveText(options.provider) || ruleCtx.provider,
        profileId: resolveText(options.profileId) || ruleCtx.profileId,
        withTools: typeof options.withTools === 'boolean' ? options.withTools : ruleCtx.withTools,
        toolAllow: options.toolAllow ?? ruleCtx.toolAllow,
        toolMaxSteps: options.toolMaxSteps ?? ruleCtx.toolMaxSteps,
        memory: options.memory,
        cwd: workspaceDir,
      });

      const parsed = parseDecision(agentResult.result);
      void appendHeartbeatLog({
        eventType: "rule-result",
        runId,
        timestamp: now,
        ruleId: rule.id,
        ruleText: rule.ruleText,
        provider: resolveText(options.provider) || ruleCtx.provider,
        profileId: resolveText(options.profileId) || ruleCtx.profileId,
        withTools: typeof options.withTools === "boolean" ? options.withTools : rule.withTools,
        toolAllow: options.toolAllow ?? ruleCtx.toolAllow,
        toolMaxSteps: options.toolMaxSteps ?? ruleCtx.toolMaxSteps,
        rawDecision: resolveLogPayloadLimit(agentResult.result ?? ""),
        parsedDecision: parsed.decision,
        parseError: parsed.parseError,
        sessionKey: `${baseSessionKey}:${ruleCtx.sessionKey}`,
      });
      rule.lastRunAt = now;

      if (parsed.decision === 'trigger') {
        rule.lastTriggerAt = now;
        rule.lastStatus = 'trigger';
        rule.lastStatusMessage = parsed.message;
        summary.triggered += 1;

        const triggeredResult: HeartbeatRunResult = {
          ruleId: rule.id,
          ruleText: rule.ruleText,
          timestamp: now,
          status: 'triggered',
          decision: 'trigger',
          decisionRaw: parsed.raw,
          message: parsed.message,
        };
        summary.results.push(triggeredResult);
        void appendHeartbeatLog({
          eventType: "rule-result",
          runId,
          timestamp: now,
          ruleId: rule.id,
          ruleText: rule.ruleText,
          provider: resolveText(options.provider) || ruleCtx.provider,
          profileId: resolveText(options.profileId) || ruleCtx.profileId,
          withTools: typeof options.withTools === "boolean" ? options.withTools : rule.withTools,
          toolAllow: options.toolAllow ?? ruleCtx.toolAllow,
          toolMaxSteps: options.toolMaxSteps ?? ruleCtx.toolMaxSteps,
          rawDecision: resolveLogPayloadLimit(agentResult.result ?? ""),
          parsedDecision: parsed.decision,
          status: triggeredResult.status,
          reason: triggeredResult.message || triggeredResult.decisionRaw,
          sessionKey: `${baseSessionKey}:${ruleCtx.sessionKey}`,
        });
        options.onResult?.(triggeredResult);

        if (options.send) {
          try {
            await options.send({
              rule,
              triggerMessage: parsed.message,
              now,
              rawDecision: parsed.raw,
            });
          } catch (error) {
            const failure = error instanceof Error ? error.message : String(error);
              summary.errors += 1;
              summary.triggered -= 1;
              summary.results.pop();
              rule.lastStatus = 'error';
              rule.lastStatusMessage = failure;

            const erroredResult: HeartbeatRunResult = {
              ruleId: rule.id,
              ruleText: rule.ruleText,
              timestamp: now,
              status: 'errored',
              decision: 'error',
              decisionRaw: parsed.raw,
              reason: failure,
            };
            void appendHeartbeatLog({
              eventType: "rule-error",
              runId,
              timestamp: now,
              ruleId: rule.id,
              ruleText: rule.ruleText,
              provider: resolveText(options.provider) || ruleCtx.provider,
              profileId: resolveText(options.profileId) || ruleCtx.profileId,
              withTools: typeof options.withTools === "boolean" ? options.withTools : rule.withTools,
              toolAllow: options.toolAllow ?? ruleCtx.toolAllow,
              toolMaxSteps: options.toolMaxSteps ?? ruleCtx.toolMaxSteps,
              parsedDecision: "error",
              status: erroredResult.status,
              reason: failure,
              rawDecision: resolveLogPayloadLimit(agentResult.result ?? ""),
              message: parseDecision(agentResult.result).message,
              sessionKey: `${baseSessionKey}:${ruleCtx.sessionKey}`,
            });
            summary.results.push(erroredResult);
            options.onResult?.(erroredResult);
          }
        }
        continue;
      }

      if (parsed.decision === 'skip') {
        rule.lastStatus = 'skip';
        rule.lastStatusMessage = parsed.message;
        summary.skipped += 1;

        const skippedResult: HeartbeatRunResult = {
          ruleId: rule.id,
          ruleText: rule.ruleText,
          timestamp: now,
          status: 'skipped',
          decision: 'skip',
          decisionRaw: parsed.raw,
          message: parsed.message,
        };
        summary.results.push(skippedResult);
        void appendHeartbeatLog({
          eventType: "rule-result",
          runId,
          timestamp: now,
          ruleId: rule.id,
          ruleText: rule.ruleText,
          provider: resolveText(options.provider) || ruleCtx.provider,
          profileId: resolveText(options.profileId) || ruleCtx.profileId,
          withTools: typeof options.withTools === "boolean" ? options.withTools : rule.withTools,
          toolAllow: options.toolAllow ?? ruleCtx.toolAllow,
          toolMaxSteps: options.toolMaxSteps ?? ruleCtx.toolMaxSteps,
          rawDecision: resolveLogPayloadLimit(agentResult.result ?? ""),
          parsedDecision: parsed.decision,
          parseError: parsed.parseError,
          status: skippedResult.status,
          reason: skippedResult.reason,
          message: skippedResult.message,
          sessionKey: `${baseSessionKey}:${ruleCtx.sessionKey}`,
        });
        options.onResult?.(skippedResult);
        continue;
      }

      summary.errors += 1;
      rule.lastStatus = 'error';
      rule.lastStatusMessage = parsed.parseError || 'Unknown parse error';
      const erroredResult: HeartbeatRunResult = {
        ruleId: rule.id,
        ruleText: rule.ruleText,
        timestamp: now,
        status: 'errored',
        decision: 'error',
        decisionRaw: parsed.raw,
        reason: parsed.parseError || 'Unknown parse error',
      };
      summary.results.push(erroredResult);
      void appendHeartbeatLog({
        eventType: "rule-error",
        runId,
        timestamp: now,
        ruleId: rule.id,
        ruleText: rule.ruleText,
        provider: resolveText(options.provider) || ruleCtx.provider,
        profileId: resolveText(options.profileId) || ruleCtx.profileId,
        withTools: typeof options.withTools === "boolean" ? options.withTools : rule.withTools,
        toolAllow: options.toolAllow ?? ruleCtx.toolAllow,
        toolMaxSteps: options.toolMaxSteps ?? ruleCtx.toolMaxSteps,
        rawDecision: "",
        parsedDecision: "error",
        status: erroredResult.status,
        reason: erroredResult.reason,
      });
      options.onResult?.(erroredResult);
    } catch (error) {
      summary.errors += 1;
      const errorMessage = error instanceof Error ? error.message : String(error);
      rule.lastRunAt = now;
      rule.lastStatus = 'error';
      rule.lastStatusMessage = errorMessage;
      const erroredResult: HeartbeatRunResult = {
        ruleId: rule.id,
        ruleText: rule.ruleText,
        timestamp: now,
        status: 'errored',
        decision: 'error',
        decisionRaw: '',
        reason: errorMessage,
      };
      summary.results.push(erroredResult);
      void appendHeartbeatLog({
        eventType: "rule-error",
        runId,
        timestamp: now,
        ruleId: rule.id,
        ruleText: rule.ruleText,
        provider: resolveText(options.provider) || ruleCtx.provider,
        profileId: resolveText(options.profileId) || ruleCtx.profileId,
        withTools: typeof options.withTools === "boolean" ? options.withTools : rule.withTools,
        toolAllow: options.toolAllow ?? ruleCtx.toolAllow,
        toolMaxSteps: options.toolMaxSteps ?? ruleCtx.toolMaxSteps,
        parsedDecision: "error",
        status: erroredResult.status,
        reason: erroredResult.reason,
        sessionKey: `${baseSessionKey}:${ruleCtx.sessionKey}`,
      });
      options.onResult?.(erroredResult);
    }
  }

  void appendHeartbeatLog({
    eventType: "run-summary",
    runId,
    timestamp: now,
    provider: resolveText(options.provider) || undefined,
    profileId: resolveText(options.profileId),
    withTools: typeof options.withTools === "boolean" ? options.withTools : undefined,
    toolAllow: options.toolAllow,
    toolMaxSteps: options.toolMaxSteps,
    status: summary.errors > 0 ? "errored" : summary.triggered > 0 ? "triggered" : "skipped",
    reason: `total=${summary.total} evaluated=${summary.evaluated} triggered=${summary.triggered} skipped=${summary.skipped} errors=${summary.errors}`,
  });

  await saveHeartbeatRules(nextRules, workspaceDir);
  return summary;
}

export function startHeartbeatLoop(
  intervalMs: number,
  options: Omit<HeartbeatLoopOptions, 'intervalMs'>,
): HeartbeatLoopHandle {
  const safeInterval = Math.max(1000, Math.floor(intervalMs));
  let stopRequested = false;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<HeartbeatRunSummary> | null = null;

  const requestRun = async () => {
    if (!running) {
      running = runHeartbeatOnce(options)
        .then((summary) => {
          options.onSummary?.(summary);
          return summary;
        })
        .finally(() => {
          running = null;
        });
    }
    return running;
  };

  const scheduleNext = (ms: number) => {
    if (stopRequested) {
      return;
    }
    timer = setTimeout(async () => {
      timer = null;
      if (stopRequested) {
        return;
      }
      await requestRun().catch(() => {
        // Errors are already embedded in summary results.
      });
      scheduleNext(safeInterval);
    }, ms);
    timer.unref?.();
  };

  const handle: HeartbeatLoopHandle = {
    stop: () => {
      stopRequested = true;
      if (timer) {
        clearTimeout(timer);
      }
      timer = null;
    },
    runOnce: () => {
      return requestRun();
    },
  };

  scheduleNext(safeInterval);
  return handle;
}
