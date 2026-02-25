import path from "node:path";
import { Agent, type AgentEvent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel, type Message as PiMessage, type StopReason as PiStopReason } from "@mariozechner/pi-ai";
import type { Message } from "@mariozechner/pi-ai";
import { getOpenAICodexApiContext, OPENAI_CODEX_MODEL } from "../auth/authManager.js";
import { ContextToolSpec, RequestContext } from "../shared/types.js";
import type { AdapterResult } from "../adapters/stubAdapter.js";
import { chooseFirstToolError, resolveStepLimitError } from "./tools.js";
import { resolveToolMaxSteps } from "./context.js";
import { ToolSandbox, createDefaultToolSandboxOptions } from "./toolSandbox.js";
import {
  createRuntimeRunId,
  loadRuntimeExecutionState,
  persistRuntimeExecutionState,
} from "./stateStore.js";
import type { ToolCall, ToolExecutionLog, ToolError } from "../tools/types.js";
import type { RuntimeExecutionState } from "./schema.js";

interface RuntimeOptions {
  requestContext: RequestContext;
  channel: string;
  withTools: boolean;
  toolAllow: string[];
  toolMaxSteps?: number;
  cwd?: string;
  toolSpecs?: ContextToolSpec[];
  timeoutMs?: number;
  maxConcurrentTools?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
}

function toRuntimeToolName(raw: string): string {
  const normalized = raw.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return normalized.length > 0 ? normalized : `tool_${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
}

type RuntimeToolNameMap = {
  codexByCanonical: Map<string, string>;
  canonicalByCodex: Map<string, string>;
};

function createRuntimeToolNameMap(toolSpecs: ContextToolSpec[]): RuntimeToolNameMap {
  const used = new Set<string>();
  const codexByCanonical = new Map<string, string>();
  const canonicalByCodex = new Map<string, string>();

  for (const spec of toolSpecs) {
    const canonical = typeof spec.name === "string" ? spec.name : "";
    if (!canonical) {
      continue;
    }

    let preferred = toRuntimeToolName(canonical);
    if (!preferred.length) {
      preferred = `tool_${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`;
    }
    let candidate = preferred;
    let counter = 1;
    while (used.has(candidate)) {
      counter += 1;
      candidate = `${preferred}_${counter}`;
    }
    used.add(candidate);
    codexByCanonical.set(canonical, candidate);
    canonicalByCodex.set(candidate, canonical);
  }

  return { codexByCanonical, canonicalByCodex };
}

function sanitizeRuntimeToolName(raw: string, codexByCanonical: Map<string, string>): string {
  return codexByCanonical.get(raw) ?? raw;
}

function remapToolNameInContent(content: unknown, codexByCanonical: Map<string, string>): unknown {
  if (!content || typeof content !== "object") {
    return content;
  }
  const candidate = content as Record<string, unknown>;
  const type = typeof candidate.type === "string" ? candidate.type : "";
  if (type !== "toolCall" && type !== "tool_call" && type !== "toolResult") {
    return content;
  }

  const toolName =
    typeof candidate.name === "string"
      ? candidate.name
      : typeof candidate.toolName === "string"
        ? candidate.toolName
        : "";
  if (!toolName) {
    return content;
  }

  const mapped = sanitizeRuntimeToolName(toolName, codexByCanonical);
  if (type === "toolResult") {
    return { ...candidate, toolName: mapped };
  }
  return { ...candidate, name: mapped };
}

function remapRuntimeMessages(rawMessages: unknown, codexByCanonical: Map<string, string>): PiMessage[] {
  if (!Array.isArray(rawMessages)) {
    return [];
  }

  return rawMessages
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }

      const message = item as Record<string, unknown>;
      const normalized: Record<string, unknown> = { ...message };

      if (Array.isArray(message.content)) {
        normalized.content = message.content.map((block) => remapToolNameInContent(block, codexByCanonical));
      }

      if (typeof message.toolName === "string") {
        normalized.toolName = sanitizeRuntimeToolName(message.toolName, codexByCanonical);
      }

      return normalized as unknown as PiMessage;
    })
    .filter((message): message is PiMessage => message !== undefined);
}

function shouldFollowUpBeforeContinue(previous: RuntimeExecutionState): boolean {
  if (!previous) {
    return false;
  }

  if (previous.phase !== "running" && previous.phase !== "failed") {
    return false;
  }

  const hasPendingToolCalls = Array.isArray(previous.agentState?.pendingToolCalls)
    && previous.agentState.pendingToolCalls.length > 0;
  const hasInProgressTool = typeof previous.toolRunId === "string" && previous.toolRunId.length > 0;
  const lastMessage = (Array.isArray(previous.agentState?.messages) ? previous.agentState.messages : [])
    .at(-1);

  if (hasInProgressTool || hasPendingToolCalls) {
    return false;
  }

  if (!lastMessage || lastMessage.role === "user") {
    return false;
  }

  return true;
}

export interface RuntimeResult {
  adapter: AdapterResult;
  restored: boolean;
  runState: RuntimeExecutionState;
}

const RUNTIME_PROVIDER = "openai-codex";

function nowIso(): string {
  return new Date().toISOString();
}

function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

function toText(message: Message | undefined): string {
  if (!message) {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  if (!Array.isArray(message.content)) {
    return "";
  }
  return message.content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      if (block.type === "text" && typeof (block as { text?: unknown }).text === "string") {
        return (block as { text: string }).text;
      }
      return "";
    })
    .filter((entry) => entry.length > 0)
    .join("\n");
}

function normalizeToolContent(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw == null) {
    return "";
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

function resolveTools(input: ContextToolSpec[] | undefined, withTools: boolean): ContextToolSpec[] {
  if (!withTools || !Array.isArray(input)) {
    return [];
  }
  return input.filter((item) => item && typeof item.name === "string" && item.name.trim().length > 0);
}

function resolveStage(profileId: string, phase: RuntimeExecutionState["phase"]): string {
  if (phase === "suspended") {
    return `runtime.codex.${profileId}.suspended`;
  }
  if (phase === "failed") {
    return `runtime.codex.${profileId}.failed`;
  }
  return `adapter.codex.${profileId}`;
}

function snapshotAgentState(agent: Agent, modelId: string): RuntimeExecutionState["agentState"] {
  const state = agent.state;
  return {
    systemPrompt: state.systemPrompt,
    model: {
      provider: RUNTIME_PROVIDER,
      id: modelId,
    },
    thinkingLevel: state.thinkingLevel,
    tools: state.tools.map((tool) => tool.name),
    messages: state.messages as PiMessage[],
    isStreaming: state.isStreaming,
    streamMessage: state.streamMessage as PiMessage | null | undefined,
    pendingToolCalls: Array.from(state.pendingToolCalls ?? []),
    ...(state.error ? { error: state.error } : {}),
  };
}

function createToolAdapter(
  tools: ContextToolSpec[],
  runTool: (call: ToolCall, signal?: AbortSignal) => Promise<ToolExecutionLog>,
  toolNameMap: RuntimeToolNameMap,
): AgentTool[] {
  return tools.map((spec) => ({
    name: toolNameMap.codexByCanonical.get(spec.name) ?? toRuntimeToolName(spec.name),
    label: spec.name,
    description: spec.description,
    parameters: spec.inputSchema as unknown as AgentTool["parameters"],
    execute: async (toolCallId, params, signal) => {
      const codexName = toolNameMap.codexByCanonical.get(spec.name) ?? toRuntimeToolName(spec.name);
      const canonicalName = toolNameMap.canonicalByCodex.get(codexName) ?? spec.name;
      const log = await runTool(
        {
          id: toolCallId,
          name: canonicalName,
          args: params,
          source: "agent-runtime",
        },
        signal,
      );
      if (!log.result.ok) {
        throw new Error(log.result.error?.message ?? `tool ${spec.name} failed`);
      }
      return {
        content: normalizeToolContent(log.result.content)
          ? [{ type: "text", text: normalizeToolContent(log.result.content) }]
          : [],
        details: {
          tool: canonicalName,
          toolCallId: log.call.id,
          meta: log.result.meta,
        },
      };
    },
  }));
}

function buildBaseRuntimeState(
  channel: string,
  sessionKey: string,
  sessionId: string,
  profileId: string,
): RuntimeExecutionState {
  const runId = createRuntimeRunId();
  return {
    version: 1,
    channel,
    sessionKey,
    sessionId,
    provider: RUNTIME_PROVIDER,
    profileId,
    runId,
    runCreatedAt: nowIso(),
    runUpdatedAt: nowIso(),
    phase: "running",
    planId: `plan-${runId}`,
    stepId: 0,
  };
}

export async function runOpenAICodexRuntime(input: RuntimeOptions): Promise<RuntimeResult> {
  const requestContext = input.requestContext;
  const requestId = requestContext.requestId;
  const channel = input.channel || "agent";
  const toolMaxSteps = resolveToolMaxSteps(input.toolMaxSteps);
  const toolSpecs = resolveTools(input.toolSpecs, input.withTools);
  const cwd = path.resolve(input.cwd || process.cwd());
  const toolNameMap = createRuntimeToolNameMap(toolSpecs);

  const { apiKey, profile } = await getOpenAICodexApiContext(requestContext.profileId);
  const model = getModel("openai-codex", OPENAI_CODEX_MODEL);
  if (!model) {
    throw new Error(`No model found: openai-codex/${OPENAI_CODEX_MODEL}`);
  }

  const profileId = profile.id;
  const previous = await loadRuntimeExecutionState(channel, requestContext.sessionKey);
  const shouldRestore = Boolean(
    previous
      && previous.phase !== "idle"
      && previous.sessionId === requestContext.sessionId
      && previous.profileId === profileId,
  );

  const runState = shouldRestore ? previous! : buildBaseRuntimeState(
    channel,
    requestContext.sessionKey,
    requestContext.sessionId,
    profileId,
  );
  const runId = runState.runId;
  const planId = runState.planId || `plan-${runId}`;

  let stepId = Number.isFinite(runState.stepId) ? Math.max(0, Math.floor(runState.stepId)) : 0;
  let toolLoopCount = 0;

  const toolCalls: ToolCall[] = [];
  const toolResults: ToolExecutionLog[] = [];
  let toolError: ToolError | undefined;
  const toolLogsById = new Map<string, ToolExecutionLog>();

  const recordToolLog = (log: ToolExecutionLog) => {
    const existing = toolLogsById.get(log.call.id);
    if (!existing) {
      toolCalls.push(log.call);
      toolResults.push(log);
      toolLogsById.set(log.call.id, log);
    } else {
      const last = {
        ...existing,
        ...log,
      };
      toolLogsById.set(log.call.id, last);
      const index = toolResults.findIndex((entry) => entry.call.id === log.call.id);
      if (index >= 0) {
        toolResults[index] = last;
      }
    }
    if (isDefined(log.result.error)) {
      toolError = chooseFirstToolError(toolError, log.result.error);
    }
  };

  const sandbox = new ToolSandbox({
    ...createDefaultToolSandboxOptions(),
    ...(isDefined(input.timeoutMs) ? { timeoutMs: input.timeoutMs } : {}),
    ...(isDefined(input.maxConcurrentTools) ? { maxConcurrentTools: input.maxConcurrentTools } : {}),
    ...(isDefined(input.retryAttempts) ? { retryAttempts: input.retryAttempts } : {}),
    ...(isDefined(input.retryDelayMs) ? { retryDelayMs: input.retryDelayMs } : {}),
    ...(isDefined(input.toolAllow) && input.toolAllow.length > 0 ? { allowList: input.toolAllow } : {}),
  });

  const runTool = async (toolCall: ToolCall, signal?: AbortSignal): Promise<ToolExecutionLog> => {
    const log = await sandbox.execute(toolCall, {
      requestId,
      sessionId: requestContext.sessionId,
      sessionKey: requestContext.sessionKey,
      cwd,
      signal,
    });
    recordToolLog(log);
    return log;
  };

  const agentTools = createToolAdapter(toolSpecs, runTool, toolNameMap);
  const initialMessages = (shouldRestore && runState.agentState?.messages?.length)
    ? remapRuntimeMessages(runState.agentState.messages, toolNameMap.codexByCanonical)
    : requestContext.messages;
  const agent = new Agent({
    initialState: {
      systemPrompt: requestContext.systemPrompt ?? "",
      model,
      messages: initialMessages,
      tools: agentTools,
    },
    convertToLlm: (messages) =>
      messages.filter((message) =>
        message.role === "user" || message.role === "assistant" || message.role === "toolResult",
      ) as Message[],
    getApiKey: async () => apiKey,
  });
  agent.setTools(agentTools);

  let finalMessage: Message | undefined;
  let finalStopReason: PiStopReason | undefined;
  let lastError: string | undefined;
  let finalPhase: RuntimeExecutionState["phase"] = "running";
  let runErr: Error | undefined;
  let limitExceeded = false;
  let shouldPersistLastGoodSnapshot = false;
  let eventSeq = 0;

  const applyState = async (patch: Partial<RuntimeExecutionState>): Promise<void> => {
    const eventId = `${requestId}-${++eventSeq}`;
    await persistRuntimeExecutionState({
      channel,
      sessionKey: requestContext.sessionKey,
      sessionId: requestContext.sessionId,
      provider: RUNTIME_PROVIDER,
      profileId,
      runId,
      eventId,
      patch,
    });
  };

  const userMessage: Message = {
    role: "user",
    content: requestContext.input,
    timestamp: Date.now(),
  };

  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    if (event.type === "agent_start") {
      finalPhase = "running";
      void applyState({ phase: "running", stepId, planId, lastRequestId: requestId });
    }
    if (event.type === "turn_start") {
      stepId += 1;
      void applyState({ phase: "running", stepId, planId, lastRequestId: requestId });
    }
    if (event.type === "tool_execution_start") {
      void applyState({ phase: "running", toolRunId: event.toolCallId, lastRequestId: requestId });
    }
    if (event.type === "tool_execution_end") {
      void applyState({ phase: "running", toolRunId: undefined, lastRequestId: requestId });
    }
        if (event.type === "message_end") {
          if (event.message.role === "assistant") {
            finalMessage = event.message;
            finalStopReason = event.message.stopReason;
          }
        }
    if (event.type === "turn_end") {
      if (event.toolResults.length > 0) {
        toolLoopCount += 1;
        if (toolLoopCount >= toolMaxSteps) {
          limitExceeded = true;
          finalPhase = "suspended";
          lastError = `tool call loop exceeded max steps (${toolMaxSteps})`;
          agent.abort();
        }
      }
    }
    if (event.type === "agent_end") {
      finalPhase = finalPhase === "suspended" ? "suspended" : "idle";
      shouldPersistLastGoodSnapshot = finalPhase === "idle";
    }
    const eventPhase: RuntimeExecutionState["phase"] = finalPhase;
    void applyState({
      phase: eventPhase,
      stepId,
      planId,
      lastRequestId: requestId,
      lastGoodSnapshot: shouldPersistLastGoodSnapshot
        ? {
          runId,
          updatedAt: nowIso(),
          stepId,
        }
        : undefined,
      agentState: snapshotAgentState(agent, model.id),
    });
  });

  try {
    if (shouldRestore) {
      if (shouldFollowUpBeforeContinue(previous!)) {
        await agent.prompt(userMessage);
      } else {
        await agent.continue();
        agent.followUp(userMessage);
        await agent.continue();
      }
    } else {
      await agent.prompt(userMessage);
    }
  } catch (error) {
    runErr = error instanceof Error ? error : new Error(String(error));
  } finally {
    unsubscribe();
    if (runErr && isDefined((runErr as { name?: unknown }).name) && runErr.name === "AbortError") {
      finalPhase = "suspended";
      lastError = "agent runtime aborted while running tool steps";
    }
  }

  if (limitExceeded) {
    finalPhase = "suspended";
    const limitError = resolveStepLimitError(toolCalls, toolMaxSteps);
    toolError = chooseFirstToolError(toolError, limitError);
  } else if (finalPhase !== "suspended" && runErr && !toolError) {
    throw runErr;
  }
  if (runErr && (toolError || finalPhase === "suspended")) {
    finalPhase = finalPhase === "running" ? "failed" : finalPhase;
    lastError = lastError || runErr.message;
  }

  const finalAdapter: AdapterResult = {
    route: "codex",
    stage: resolveStage(profileId, finalPhase),
    result: toText(finalMessage) || requestContext.input,
    toolCalls,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    assistantMessage: finalMessage,
    stopReason: finalStopReason,
    provider: RUNTIME_PROVIDER,
    profileId,
  };

  await applyState({
    phase: finalPhase,
    stepId,
    planId,
    lastRequestId: requestId,
    lastError,
    lastGoodSnapshot:
      shouldPersistLastGoodSnapshot
        ? {
          runId,
          updatedAt: nowIso(),
          stepId,
        }
        : runState.lastGoodSnapshot,
    agentState: snapshotAgentState(agent, model.id),
  });

  return {
    restored: shouldRestore,
    runState: {
      ...runState,
      phase: finalPhase,
      planId,
      stepId,
      lastRequestId: requestId,
      runUpdatedAt: nowIso(),
      lastError,
      agentState: snapshotAgentState(agent, model.id),
    },
    adapter: finalAdapter,
  };
}
