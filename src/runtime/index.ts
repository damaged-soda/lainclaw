import { ValidationError, type GatewayResult } from "../shared/types.js";
import { runRuntime } from "./entrypoint.js";
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
import { sessionService } from "../sessions/sessionService.js";
import { listTools } from "../tools/registry.js";
import { firstToolErrorFromLogs } from "../tools/runtimeTools.js";

type RunAgentOptions = {
  provider?: string;
  profileId?: string;
  sessionKey?: string;
  newSession?: boolean;
  memory?: boolean;
  withTools?: boolean;
  toolAllow?: string[];
  cwd?: string;
};

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

  if (input === NEW_SESSION_COMMAND) {
    const newSession = await sessionService.resolveSession({
      sessionKey,
      provider,
      profileId,
      forceNew: true,
      ...(typeof memoryEnabled === "boolean" ? { memory: memoryEnabled } : {}),
    });
    const memoryFile = newSession.memoryEnabled ? sessionService.resolveSessionMemoryPath(newSession.sessionKey) : undefined;

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
      ...(memoryFile ? { memoryFile } : {}),
      sessionContextUpdated: false,
    };
  }

  const requestSystemPrompt = await buildWorkspaceSystemPrompt(opts.cwd);
  const session = await sessionService.resolveSession({
    sessionKey,
    provider,
    profileId,
    forceNew: !!opts.newSession,
    ...(typeof memoryEnabled === "boolean" ? { memory: memoryEnabled } : {}),
  });

  const memorySnippet = session.memoryEnabled ? await sessionService.loadMemorySnippet(session.sessionKey) : "";
  const priorMessages = await sessionService.loadHistory(session.sessionId);

  const autoTools = listTools({ allowList: toolAllow }).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
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

  const runtimeResult = await runRuntime({
    requestContext,
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
    await sessionService.appendToolSummary(
      session.sessionId,
      toolCalls,
      toolResults,
      finalResult.route,
      finalResult.stage,
      finalResult.provider,
      finalResult.profileId,
    );
  }
  await sessionService.appendTurnMessages(session.sessionId, input, {
    route: finalResult.route,
    stage: finalResult.stage,
    result: finalResult.result,
    provider: finalResult.provider,
    profileId: finalResult.profileId,
  });
  await sessionService.markRouteUsage(sessionKey, finalResult.route, finalResult.profileId, finalResult.provider);

  const memoryUpdated = await sessionService.compactIfNeeded({
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
    memoryFile: session.memoryEnabled ? sessionService.resolveSessionMemoryPath(session.sessionKey) : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    ...(toolError ? { toolError } : {}),
    sessionContextUpdated,
  };
}

function resolveProvider(raw: string | undefined): string {
  const normalized = raw?.trim();
  if (!normalized || normalized.length === 0) {
    throw new ValidationError(
      "Missing provider. Set --provider in command args or runtime config.",
      "MISSING_PROVIDER",
    );
  }
  return normalized;
}
