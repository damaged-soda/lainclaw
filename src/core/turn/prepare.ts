import {
  buildRuntimeRequestContext,
  contextMessagesFromHistory,
} from "../../runtime/context.js";
import { buildSystemPrompt } from "../../prompt/systemPrompt.js";
import {
  agentStateStore,
  normalizePersistedMessages,
  type AgentStateSnapshot,
} from "../../sessions/agentSnapshotStore.js";
import type { CoreTurnDependencies, PreparedTurn, PrepareTurnInput } from "./contracts.js";
import { resolveCoreTurnRunMode } from "./runMode.js";

function matchesSnapshot(
  snapshot: AgentStateSnapshot | undefined,
  input: PrepareTurnInput,
  sessionId: string,
): snapshot is AgentStateSnapshot {
  return Boolean(
    snapshot &&
    snapshot.sessionId === sessionId &&
    snapshot.provider === input.provider &&
    snapshot.profileId === input.profileId,
  );
}

export async function prepareCoreTurn(
  input: PrepareTurnInput,
  dependencies: CoreTurnDependencies,
): Promise<PreparedTurn> {
  const sessionPort = dependencies.sessionPort;
  const stateStore = dependencies.stateStore ?? agentStateStore;

  const session = await sessionPort.resolveSession({
    sessionKey: input.sessionKey,
    provider: input.provider,
    profileId: input.profileId,
    forceNew: false,
    ...(typeof input.memoryEnabled === "boolean" ? { memory: input.memoryEnabled } : {}),
  });

  const [transcriptMessages, memorySnippet, snapshot] = await Promise.all([
    sessionPort.loadTranscriptMessages(session.sessionId),
    sessionPort.loadMemorySnippet(session.sessionKey),
    stateStore.load(session.sessionKey),
  ]);

  const hasMatchingSnapshot = matchesSnapshot(snapshot, input, session.sessionId);
  const source = hasMatchingSnapshot
    ? "snapshot"
    : transcriptMessages.length > 0
      ? "transcript"
      : "new";
  const initialMessages = hasMatchingSnapshot
    ? normalizePersistedMessages(snapshot.messages)
    : source === "transcript"
      ? contextMessagesFromHistory(transcriptMessages, input.provider)
      : [];
  const initialSystemPrompt = hasMatchingSnapshot ? snapshot.systemPrompt : undefined;
  const resolvedRunMode = resolveCoreTurnRunMode({
    rawInput: input.input,
    requestedRunMode: input.runMode,
    requestedContinueReason: input.continueReason,
    source,
    initialMessages,
  });
  const resolvedCwd = input.cwd ?? process.cwd();
  const systemPrompt = await buildSystemPrompt({
    cwd: resolvedCwd,
    ...(typeof input.systemPrompt === "string" ? { basePrompt: input.systemPrompt } : {}),
  });

  const runtimeContext = buildRuntimeRequestContext({
    requestId: input.requestId,
    createdAt: input.createdAt,
    input: input.input,
    sessionKey: session.sessionKey,
    sessionId: session.sessionId,
    bootstrapMessages: source === "transcript" ? transcriptMessages : [],
    memorySnippet,
    provider: input.provider,
    profileId: input.profileId,
    withTools: input.withTools,
    systemPrompt,
    runMode: resolvedRunMode.runMode,
    ...(resolvedRunMode.continueReason
      ? { continueReason: resolvedRunMode.continueReason }
      : {}),
    memoryEnabled: session.memoryEnabled,
    ...(typeof input.contextMessageLimit === "number"
      ? { contextMessageLimit: input.contextMessageLimit }
      : {}),
    debug: input.debug === true,
  });

  return {
    session,
    providerInput: {
      requestContext: runtimeContext.requestContext,
      preparedState: {
        source,
        initialMessages,
        ...(initialSystemPrompt ? { initialSystemPrompt } : {}),
      },
      withTools: input.withTools,
      cwd: resolvedCwd,
    },
  };
}
