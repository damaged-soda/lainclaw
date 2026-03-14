import {
  agentStateStore,
  normalizePersistedMessages,
} from "../../runtime/agentStateStore.js";
import type {
  CommitTurnInput,
  CommitTurnResult,
  CoreTurnDependencies,
} from "./contracts.js";

function nowIso(): string {
  return new Date().toISOString();
}

export async function commitCoreTurn(
  input: CommitTurnInput,
  dependencies: CoreTurnDependencies,
): Promise<CommitTurnResult> {
  const sessionPort = dependencies.sessionPort;
  const stateStore = dependencies.stateStore ?? agentStateStore;
  const session = input.preparedTurn.session;
  const requestContext = input.preparedTurn.providerInput.requestContext;
  const runtimeResult = input.runtimeResult;

  await sessionPort.appendTurnMessages(
    session.sessionId,
    requestContext.input,
    {
      route: runtimeResult.route,
      stage: runtimeResult.stage,
      result: runtimeResult.result,
      provider: runtimeResult.provider,
      profileId: runtimeResult.profileId,
    },
    {
      includeUserMessage: requestContext.runMode === "prompt",
    },
  );

  if (runtimeResult.sessionState) {
    await stateStore.save({
      version: 2,
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      provider: runtimeResult.provider,
      profileId: runtimeResult.profileId,
      systemPrompt: runtimeResult.sessionState.systemPrompt,
      messages: normalizePersistedMessages(runtimeResult.sessionState.messages),
      updatedAt: nowIso(),
    });
  }

  await sessionPort.markRouteUsage(
    session.sessionKey,
    runtimeResult.route,
    runtimeResult.profileId,
    runtimeResult.provider,
  );

  const memoryUpdated = await sessionPort.compactIfNeeded({
    sessionKey: session.sessionKey,
    sessionId: session.sessionId,
    memoryEnabled: session.memoryEnabled,
    compactedMessageCount: session.compactedMessageCount,
  });

  return { memoryUpdated };
}
