import { ValidationError, type GatewayResult, type RequestContext } from "../shared/types.js";
import { runOpenAICodexRuntime } from "./entrypoint.js";
import {
  appendTurnMessages,
  appendToolSummaryToHistory,
  compactSessionMemoryIfNeeded,
  persistRouteUsage,
  resolveSessionMemoryPath,
} from "./persistence.js";
import { listAutoTools } from "./tools.js";
import {
  buildWorkspaceSystemPrompt,
  buildRuntimeRequestContext,
  createRequestId,
  nowIso,
  normalizeToolAllow,
  resolveMemoryFlag,
  resolveSessionKey,
  NEW_SESSION_COMMAND,
  NEW_SESSION_ROUTE,
  NEW_SESSION_STAGE,
} from "./context.js";
import {
  getOrCreateSession,
  getRecentSessionMessages,
  getSessionMemoryPath,
  loadSessionMemorySnippet,
} from "../sessions/sessionStore.js";
import { firstToolErrorFromLogs } from "./tools.js";

type RunAgentOptions = {
  provider?: string;
  profileId?: string;
  sessionKey?: string;
  newSession?: boolean;
  memory?: boolean;
  withTools?: boolean;
  toolAllow?: string[];
  cwd?: string;
  channel?: string;
};

const DEFAULT_RUNTIME_PROVIDER = "openai-codex";
const DEFAULT_CHANNEL = "agent";

// Core flow: runAgent 是 runtime 的主入口，参数解析与 runtime 协同在下方统一落地
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
  const priorMessages = await getRecentSessionMessages(session.sessionId);

  const autoTools = listAutoTools(toolAllow);
  const { requestContext } = buildRuntimeRequestContext({
    requestId,
    createdAt,
    input,
    sessionKey,
    sessionId: session.sessionId,
    priorMessages,
    memorySnippet,
    provider,
    profileId,
    withTools,
    tools: autoTools,
    systemPrompt: requestSystemPrompt,
    memoryEnabled: session.memoryEnabled,
  });

  const runtimeResult = await runOpenAICodexRuntime({
    requestContext,
    channel,
    withTools,
    toolAllow,
    cwd: opts.cwd,
    toolSpecs: withTools ? autoTools : undefined,
  });

  const finalResult = runtimeResult.adapter;
  const toolCalls = finalResult.toolCalls ?? [];
  const toolResults = finalResult.toolResults ?? [];
  const toolError = firstToolErrorFromLogs(toolResults);
  const sessionContextUpdated = toolResults.length > 0;

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
  };
}

function resolveChannel(raw: string | undefined): string {
  const normalized = raw?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_CHANNEL;
}

function resolveProvider(raw: string | undefined): string {
  const normalized = raw?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_RUNTIME_PROVIDER;
}
