import { type GatewayResult } from "../../shared/types.js";
import { ValidationError, type RequestContext } from "../../shared/types.js";
import type { AdapterResult } from "../../adapters/stubAdapter.js";
import type { ToolCall, ToolExecutionLog, ToolError } from "../../tools/types.js";
import { runPipeline } from "../../pipeline/pipeline.js";
import {
  appendTurnMessages,
  appendToolSummaryToHistory,
  compactSessionMemoryIfNeeded,
  persistRouteUsage,
  resolveSessionMemoryPath,
} from "./persistence.js";
import {
  appendToolCallContextMessages,
  chooseFirstToolError,
  classifyToolCalls,
  executeAllowedToolCalls,
  listAutoTools,
  makeToolExecutionError,
  makeToolResultContextMessage,
  normalizeToolCall,
  parseToolCallsFromPrompt,
  resolveStepLimitError,
} from "./tools.js";
import {
  ASSISTANT_FOLLOWUP_PROMPT,
  buildPromptAuditRecord,
  buildWorkspaceSystemPrompt,
  contextMessagesFromHistory,
  createRequestId,
  makeBaseRequestContext,
  makeUserContextMessage,
  nowIso,
  normalizeToolAllow,
  resolveMemoryFlag,
  resolveSessionKey,
  resolveToolMaxSteps,
  trimContextMessages,
  NEW_SESSION_COMMAND,
  NEW_SESSION_ROUTE,
  NEW_SESSION_STAGE,
} from "./context.js";
import {
  getOrCreateSession,
  getRecentSessionMessages,
  getSessionMemoryPath,
  loadSessionMemorySnippet,
} from "../../sessions/sessionStore.js";

type RunAgentOptions = {
  provider?: string;
  profileId?: string;
  sessionKey?: string;
  newSession?: boolean;
  memory?: boolean;
  withTools?: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
  cwd?: string;
  includePromptAudit?: boolean;
};

export async function runAgent(rawInput: string, opts: RunAgentOptions = {}): Promise<GatewayResult> {
  if (!rawInput || !rawInput.trim()) {
    throw new ValidationError("agent command requires non-empty input", "AGENT_INPUT_REQUIRED");
  }

  const input = rawInput.trim();
  const requestId = createRequestId();
  const createdAt = nowIso();
  const sessionKey = resolveSessionKey(opts.sessionKey);
  const provider = opts.provider?.trim();
  const profileId = opts.profileId?.trim();
  const memoryEnabled = resolveMemoryFlag(opts.memory);
  const withTools = typeof opts.withTools === "boolean" ? opts.withTools : true;
  const toolAllow = normalizeToolAllow(opts.toolAllow);
  const toolMaxSteps = resolveToolMaxSteps(opts.toolMaxSteps);

  if (input === NEW_SESSION_COMMAND) {
    const newSession = await getOrCreateSession({
      sessionKey,
      provider,
      profileId,
      forceNew: true,
      ...(typeof memoryEnabled === "boolean" ? { memory: memoryEnabled } : {}),
    });

    return {
      success: true,
      requestId,
      createdAt,
      route: NEW_SESSION_ROUTE,
      stage: NEW_SESSION_STAGE,
      result: `New session started. sessionId=${newSession.sessionId}`,
      sessionKey: newSession.sessionKey,
      sessionId: newSession.sessionId,
      memoryEnabled: !!newSession.memoryEnabled,
      memoryUpdated: false,
      ...(newSession.memoryEnabled ? { memoryFile: getSessionMemoryPath(newSession.sessionKey) } : {}),
      sessionContextUpdated: false,
    };
  }

  const requestSystemPrompt = await buildWorkspaceSystemPrompt(opts.cwd);
  const session = await getOrCreateSession({
    sessionKey,
    provider,
    profileId,
    forceNew: !!opts.newSession,
    ...(typeof memoryEnabled === "boolean" ? { memory: memoryEnabled } : {}),
  });

  const memorySnippet = session.memoryEnabled ? await loadSessionMemorySnippet(session.sessionKey) : "";
  const priorMessages = trimContextMessages(await getRecentSessionMessages(session.sessionId));
  const promptAudit = opts.includePromptAudit ? { enabled: true, records: [] } : undefined;
  let promptAuditStep = 1;
  const recordPromptAudit = (requestContext: RequestContext, routeDecision: string) => {
    if (!promptAudit) {
      return;
    }
    promptAudit.records.push(buildPromptAuditRecord(promptAuditStep, requestContext, routeDecision));
    promptAuditStep += 1;
  };

  const historyContext = contextMessagesFromHistory(priorMessages);
  if (memorySnippet) {
    historyContext.push(makeUserContextMessage(`[memory]\n${memorySnippet}`));
  }

  const parsedToolInput = parseToolCallsFromPrompt(input);
  const manualToolPath = parsedToolInput.toolCalls.length > 0 || !!parsedToolInput.parseError;
  const toolAllowForSession = toolAllow;

  const toolCalls: ToolCall[] = [];
  const toolResults: ToolExecutionLog[] = [];
  let toolError: ToolError | undefined;
  let sessionContextUpdated = false;
  let finalResult: AdapterResult | undefined;
  let finalUserContextInput = input;

  if (manualToolPath) {
    const split = classifyToolCalls(parsedToolInput.toolCalls, toolAllowForSession);
    for (const denied of split.denied) {
      const log = makeToolExecutionError(denied.call, denied.message, denied.code);
      toolCalls.push(log.call);
      toolResults.push(log);
      toolError = chooseFirstToolError(toolError, log.result.error);
    }

    if (split.allowed.length > 0) {
      const executed = await executeAllowedToolCalls(
        requestId,
        session.sessionId,
        sessionKey,
        split.allowed,
        opts.cwd,
      );
      toolCalls.push(...split.allowed.map((call) => call));
      toolResults.push(...executed.logs);
      toolError = chooseFirstToolError(toolError, executed.toolError);
    }

    if (parsedToolInput.parseError) {
      const parseError = makeToolExecutionError(
        {
          id: `tool-parse-${Date.now()}`,
          name: "tool",
          args: {
            input,
            reason: parsedToolInput.parseError,
          },
          source: "agent",
        },
        parsedToolInput.parseError,
        "invalid_args",
      );
      toolCalls.push(parseError.call);
      toolResults.push(parseError);
      toolError = chooseFirstToolError(toolError, parseError.result.error);
    }

    if (toolResults.length > 0) {
      sessionContextUpdated = true;
    }

    if (parsedToolInput.residualInput.trim()) {
      finalUserContextInput = `${parsedToolInput.residualInput.trim()}\n\n${ASSISTANT_FOLLOWUP_PROMPT}`;
    } else if (toolCalls.length > 0 || parsedToolInput.parseError) {
      finalUserContextInput = ASSISTANT_FOLLOWUP_PROMPT;
    }
  }

  if (manualToolPath) {
    const contextMessages = [...historyContext];
    if (provider === "openai-codex") {
      appendToolCallContextMessages(
        contextMessages,
        {
          roundCalls: toolCalls,
          roundResults: toolResults,
        },
        "",
        "toolUse",
        provider,
      );
    } else {
      for (const log of toolResults) {
        contextMessages.push(makeToolResultContextMessage(log));
      }
    }
    contextMessages.push(makeUserContextMessage(finalUserContextInput));

    const requestContext = makeBaseRequestContext(
      requestId,
      createdAt,
      finalUserContextInput,
      sessionKey,
      session.sessionId,
      contextMessages,
      provider,
      profileId,
      undefined,
      requestSystemPrompt,
      session.memoryEnabled,
    );
    recordPromptAudit(requestContext, "manual_tool_path");
    finalResult = (await runPipeline(requestContext)).adapter;
  } else {
    const shouldAutoCall = provider === "openai-codex" && withTools;

    if (shouldAutoCall) {
      const autoTools = listAutoTools(toolAllowForSession);
      const contextMessages = [...historyContext, makeUserContextMessage(input)];
      const requestContext = makeBaseRequestContext(
        requestId,
        createdAt,
        input,
        sessionKey,
        session.sessionId,
        contextMessages,
        provider,
        profileId,
        autoTools,
        requestSystemPrompt,
        session.memoryEnabled,
      );
      recordPromptAudit(requestContext, "auto_tool_path_step_1");

      for (let step = 0; step < toolMaxSteps; step += 1) {
        const output = await runPipeline(requestContext);
        finalResult = output.adapter;
        const roundCalls = finalResult.toolCalls?.map((call) => normalizeToolCall(call)) ?? [];
        if (roundCalls.length === 0) {
          break;
        }

        const split = classifyToolCalls(roundCalls, toolAllowForSession);
        const deniedLogs = split.denied.map((entry) =>
          makeToolExecutionError(entry.call, entry.message, entry.code),
        );
        const executed = await executeAllowedToolCalls(
          requestId,
          session.sessionId,
          sessionKey,
          split.allowed,
          opts.cwd,
        );

        const roundState = {
          roundCalls,
          roundResults: [...deniedLogs, ...executed.logs],
        };
        toolCalls.push(...roundCalls);
        toolResults.push(...roundState.roundResults);
        toolError = chooseFirstToolError(toolError, deniedLogs[0]?.result.error);
        toolError = chooseFirstToolError(toolError, executed.toolError);

        appendToolCallContextMessages(
          requestContext.messages,
          roundState,
          finalResult.result,
          finalResult.stopReason,
          provider,
        );
        if (step < toolMaxSteps - 1) {
          recordPromptAudit(requestContext, `auto_tool_path_step_${step + 2}`);
        }

        if (toolResults.length > 0) {
          sessionContextUpdated = true;
        }

        if (step === toolMaxSteps - 1) {
          toolError = chooseFirstToolError(toolError, resolveStepLimitError(roundCalls, toolMaxSteps));
          break;
        }
      }
    } else {
      const contextMessages = [...historyContext, makeUserContextMessage(input)];
      const requestContext = makeBaseRequestContext(
        requestId,
        createdAt,
        input,
        sessionKey,
        session.sessionId,
        contextMessages,
        provider,
        profileId,
        undefined,
        requestSystemPrompt,
        session.memoryEnabled,
      );
      recordPromptAudit(requestContext, "single_pass");
      finalResult = (await runPipeline(requestContext)).adapter;
    }
  }

  if (!finalResult) {
    throw new Error("agent pipeline did not return result");
  }

  await appendToolSummaryToHistory(
    session.sessionId,
    toolCalls,
    toolResults,
    finalResult.route,
    finalResult.stage,
    finalResult.provider,
    finalResult.profileId,
  );
  await appendTurnMessages(session.sessionId, manualToolPath ? finalUserContextInput : input, finalResult);
  await persistRouteUsage(sessionKey, finalResult);

  const memoryUpdated = await compactSessionMemoryIfNeeded({
    sessionKey: session.sessionKey,
    sessionId: session.sessionId,
    memoryEnabled: session.memoryEnabled,
    compactedMessageCount: session.compactedMessageCount,
  });

  return {
    success: true,
    requestId,
    createdAt,
    route: finalResult.route,
    stage: finalResult.stage,
    result: finalResult.result,
    ...(finalResult.provider ? { provider: finalResult.provider } : {}),
    ...(finalResult.profileId ? { profileId: finalResult.profileId } : {}),
    sessionKey,
    sessionId: session.sessionId,
    memoryEnabled: session.memoryEnabled,
    memoryUpdated,
    memoryFile: session.memoryEnabled ? resolveSessionMemoryPath(session.sessionKey) : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    toolError,
    ...(promptAudit ? { promptAudit } : {}),
    sessionContextUpdated,
  };
}
