import path from "node:path";
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel, type Message as PiMessage, type StopReason as PiStopReason } from "@mariozechner/pi-ai";
import type { Message } from "@mariozechner/pi-ai";
import { getOpenAICodexApiContext, OPENAI_CODEX_MODEL } from "../auth/authManager.js";
import { ContextToolSpec, RequestContext } from "../shared/types.js";
import type { AdapterResult } from "../adapters/stubAdapter.js";
import {
  buildRuntimeToolNameMap,
  chooseFirstToolError,
  createToolAdapter,
  remapRuntimeMessages,
  resolveStepLimitError,
  resolveTools,
  shouldFollowUpBeforeContinue,
} from "./tools.js";
import { resolveToolMaxSteps } from "./context.js";
import { ToolSandbox, createDefaultToolSandboxOptions } from "./toolSandbox.js";
import { createRuntimeRunId, loadRuntimeExecutionState, persistRuntimeExecutionState } from "./stateStore.js";
import type { ToolCall, ToolExecutionLog, ToolError } from "../tools/types.js";
import { RUNTIME_STATE_VERSION, type RuntimeExecutionState } from "./schema.js";

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

type RuntimeTraceStage = "build-context" | "plan-step" | "tool-run" | "persist-state" | "finalize";

interface RuntimeTraceEvent {
  stage: RuntimeTraceStage;
  sessionKey: string;
  runId: string;
  planId: string;
  toolRunId?: string;
  durationMs: number;
  errorCode?: string;
}

interface RuntimeTraceBuilder {
  emit: (stage: RuntimeTraceStage, details?: { toolRunId?: string; durationMs?: number; errorCode?: string }) => void;
}

const RUNTIME_PROVIDER = "openai-codex";
const isRuntimeTraceEnabled = /^(1|true|yes|on)$/i.test(process.env.LAINCLAW_RUNTIME_TRACE ?? "");

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

function resolveStage(profileId: string, phase: RuntimeExecutionState["phase"]): string {
  if (phase === "suspended") {
    return `runtime.codex.${profileId}.suspended`;
  }
  if (phase === "failed") {
    return `runtime.codex.${profileId}.failed`;
  }
  return `adapter.codex.${profileId}`;
}

function snapshotAgentState(agent: InstanceType<typeof Agent>, modelId: string): RuntimeExecutionState["agentState"] {
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

function buildBaseRuntimeState(
  channel: string,
  sessionKey: string,
  sessionId: string,
  profileId: string,
): RuntimeExecutionState {
  const runId = createRuntimeRunId();
  return {
    version: RUNTIME_STATE_VERSION,
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

function createTraceBuilder(
  sessionKey: string,
  runId: string,
  planId: string,
): RuntimeTraceBuilder & { toArray: () => RuntimeTraceEvent[] } {
  if (!isRuntimeTraceEnabled) {
    return {
      emit() {},
      toArray() {
        return [];
      },
    };
  }

  const stageStartedAt: Record<RuntimeTraceStage, number> = {
    "build-context": Date.now(),
    "plan-step": Date.now(),
    "tool-run": Date.now(),
    "persist-state": Date.now(),
    finalize: Date.now(),
  };
  const events: RuntimeTraceEvent[] = [];

  const emit = (stage: RuntimeTraceStage, details: { toolRunId?: string; durationMs?: number; errorCode?: string } = {}) => {
    const timestamp = Date.now();
    const next = timestamp;
    const previous = stageStartedAt[stage];
    const durationMs = details.durationMs ?? Math.max(1, next - previous);
    stageStartedAt[stage] = next;
    events.push({
      stage,
      sessionKey,
      runId,
      planId,
      toolRunId: details.toolRunId,
      durationMs,
      errorCode: details.errorCode,
    });
    console.debug(
      JSON.stringify({
        scope: "runtime",
        source: "runtime.entrypoint",
        stage,
        sessionKey,
        runId,
        planId,
        toolRunId: details.toolRunId,
        durationMs,
        errorCode: details.errorCode,
      }),
    );
  };

  return {
    emit,
    toArray: () => events,
  };
}

export interface RuntimeResult {
  adapter: AdapterResult;
  restored: boolean;
  runState: RuntimeExecutionState;
  runtimeTrace?: RuntimeTraceEvent[];
}

export async function runOpenAICodexRuntime(input: RuntimeOptions): Promise<RuntimeResult> {
  const requestContext = input.requestContext;
  const requestId = requestContext.requestId;
  const channel = input.channel || "agent";
  const toolMaxSteps = resolveToolMaxSteps(input.toolMaxSteps);
  const toolSpecs = resolveTools(input.toolSpecs, input.withTools);
  const cwd = path.resolve(input.cwd || process.cwd());
  const toolNameMap = buildRuntimeToolNameMap(toolSpecs);

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

  const trace = createTraceBuilder(requestContext.sessionKey, runId, planId);
  trace.emit("build-context");

  let stepId = Number.isFinite(runState.stepId) ? Math.max(0, Math.floor(runState.stepId)) : 0;
  let toolLoopCount = 0;
  let currentToolRunId: string | undefined;

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
      const merged = {
        ...existing,
        ...log,
      };
      toolLogsById.set(log.call.id, merged);
      const index = toolResults.findIndex((entry) => entry.call.id === log.call.id);
      if (index >= 0) {
        toolResults[index] = merged;
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
    onTraceEvent: (toolEvent) => {
      trace.emit("tool-run", {
        toolRunId: toolEvent.toolCallId,
        durationMs: toolEvent.durationMs,
        errorCode: toolEvent.errorCode,
      });
    },
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
    const started = Date.now();
    try {
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
      trace.emit("persist-state", {
        toolRunId: currentToolRunId,
        durationMs: Math.max(1, Date.now() - started),
      });
    } catch (error) {
      trace.emit("persist-state", {
        toolRunId: currentToolRunId,
        durationMs: Math.max(1, Date.now() - started),
        errorCode: error instanceof Error ? error.name : "persist_error",
      });
      throw error;
    }
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
      trace.emit("plan-step", {
        toolRunId: currentToolRunId,
        errorCode: undefined,
      });
      void applyState({ phase: "running", stepId, planId, lastRequestId: requestId });
    }

    if (event.type === "tool_execution_start") {
      currentToolRunId = event.toolCallId;
      void applyState({ phase: "running", toolRunId: event.toolCallId, lastRequestId: requestId });
    }

    if (event.type === "tool_execution_end") {
      currentToolRunId = undefined;
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

  trace.emit("finalize", {
    toolRunId: currentToolRunId,
    errorCode: finalPhase === "failed" ? "execution_error" : undefined,
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
    ...(isRuntimeTraceEnabled ? { runtimeTrace: trace.toArray() } : {}),
  };
}
