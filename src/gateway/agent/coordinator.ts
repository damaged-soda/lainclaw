import { type GatewayResult } from "../../shared/types.js";
import { ValidationError, type RequestContext } from "../../shared/types.js";
import type { ToolExecutionLog, ToolError } from "../../tools/types.js";
import { runOpenAICodexRuntime } from "../runtime/entrypoint.js";
import {
  appendTurnMessages,
  appendToolSummaryToHistory,
  compactSessionMemoryIfNeeded,
  persistRouteUsage,
  resolveSessionMemoryPath,
} from "./persistence.js";
import { chooseFirstToolError, listAutoTools } from "./tools.js";
import {
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
  channel?: string;
};

const DEFAULT_RUNTIME_PROVIDER = "openai-codex";
const DEFAULT_CHANNEL = "agent";

function resolveChannel(raw: string | undefined): string {
  const normalized = raw?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_CHANNEL;
}

function resolveProvider(raw: string | undefined): string {
  const normalized = raw?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_RUNTIME_PROVIDER;
}

function firstToolError(logs: ToolExecutionLog[] | undefined): ToolError | undefined {
  if (!Array.isArray(logs)) {
    return undefined;
  }
  let found: ToolError | undefined;
  for (const entry of logs) {
    if (entry?.result?.error) {
      found = chooseFirstToolError(found, entry.result.error);
      if (found) {
        return found;
      }
    }
  }
  return found;
}

export async function runAgent(rawInput: string, opts: RunAgentOptions = {}): Promise<GatewayResult> {
  if (!rawInput || !rawInput.trim()) {
    throw new ValidationError("agent command requires non-empty input", "AGENT_INPUT_REQUIRED");
  }

  const input = rawInput.trim();
  const requestId = createRequestId();
  const createdAt = nowIso();
  const sessionKey = resolveSessionKey(opts.sessionKey);
  const provider = resolveProvider(opts.provider);
  const profileId = opts.profileId?.trim();
  const memoryEnabled = resolveMemoryFlag(opts.memory);
  const withTools = typeof opts.withTools === "boolean" ? opts.withTools : true;
  const toolAllow = normalizeToolAllow(opts.toolAllow);
  const toolMaxSteps = resolveToolMaxSteps(opts.toolMaxSteps);
  const channel = resolveChannel(opts.channel);

  if (provider !== "openai-codex") {
    throw new ValidationError(`Unsupported provider: ${provider}`, "UNSUPPORTED_PROVIDER");
  }

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

  const recordPromptAudit = (requestContext: RequestContext, routeDecision: string) => {
    if (!promptAudit) {
      return;
    }
    promptAudit.records.push(buildPromptAuditRecord(promptAudit.records.length + 1, requestContext, routeDecision));
  };

  const historyContext = contextMessagesFromHistory(priorMessages);
  if (memorySnippet) {
    historyContext.push(makeUserContextMessage(`[memory]\n${memorySnippet}`));
  }

  const autoTools = listAutoTools(toolAllow);
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
    withTools ? autoTools : undefined,
    requestSystemPrompt,
    session.memoryEnabled,
  );

  const runtimeResult = await runOpenAICodexRuntime({
    requestContext,
    channel,
    withTools,
    toolAllow,
    toolMaxSteps,
    cwd: opts.cwd,
    toolSpecs: withTools ? autoTools : undefined,
  });

  const finalResult = runtimeResult.adapter;
  const toolCalls = finalResult.toolCalls ?? [];
  const toolResults = finalResult.toolResults ?? [];
  const toolError = firstToolError(finalResult.toolResults);
  const sessionContextUpdated = toolResults.length > 0;

  recordPromptAudit(requestContext, runtimeResult.restored ? "runtime.restore" : "runtime.new");
  if (toolResults.length > 0) {
    await appendToolSummaryToHistory(
      session.sessionId,
      toolCalls,
      toolResults,
      finalResult.route,
      finalResult.stage,
      finalResult.provider,
      finalResult.profileId,
    );
  }
  await appendTurnMessages(session.sessionId, input, finalResult);
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
    ...(toolError ? { toolError } : {}),
    sessionContextUpdated,
    ...(promptAudit ? { promptAudit } : {}),
  };
}
