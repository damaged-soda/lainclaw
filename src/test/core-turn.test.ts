import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message, ToolResultMessage } from "@mariozechner/pi-ai";
import type { CoreSessionPort, CoreSessionRecord } from "../core/contracts.js";
import { commitCoreTurn } from "../core/turn/commit.js";
import type { PreparedTurn } from "../core/turn/contracts.js";
import { prepareCoreTurn } from "../core/turn/prepare.js";
import type { ProviderResult } from "../providers/registry.js";
import { createSessionAdapter } from "../sessions/adapter.js";
import { createAgentStateStore } from "../sessions/agentSnapshotStore.js";
import { withTempHome } from "./helpers.js";
import { resolveBuiltinSkillsDir } from "../skills/index.js";
import { resolvePaths } from "../paths/index.js";

function makeUsageZero() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function makeUserMessage(content: string): Message {
  return {
    role: "user",
    content,
    timestamp: Date.now(),
  } as Message;
}

function makeAssistantMessage(content: string): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text: content }],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-codex",
    usage: makeUsageZero(),
    stopReason: "stop",
    timestamp: Date.now(),
  } as Message;
}

function makeToolResultMessage(toolCallId: string, toolName: string, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    details: {},
    isError: false,
    timestamp: Date.now(),
  };
}

test("core turn prefers snapshot over transcript fallback and resolves continue in one place", async () => {
  await withTempHome(async () => {
    const sessionPort = createSessionAdapter();
    const stateStore = createAgentStateStore();
    const session = await sessionPort.resolveSession({
      sessionKey: "core-turn-snapshot",
      provider: "openai-codex",
      profileId: "default",
    });

    await sessionPort.appendTurnMessages(
      session.sessionId,
      "transcript fallback",
      {
        route: "adapter.stub",
        stage: "adapter.stub.test",
        result: "assistant fallback",
        provider: "openai-codex",
        profileId: "default",
      },
    );

    await stateStore.save({
      version: 2,
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      provider: "openai-codex",
      profileId: "default",
      systemPrompt: "system",
      messages: [
        makeUserMessage("snapshot user"),
        makeAssistantMessage("calling tool"),
        makeToolResultMessage("tool-1", "write", "done") as Message,
      ],
      updatedAt: "2026-03-11T00:00:00.000Z",
    });

    const prepared = await prepareCoreTurn(
      {
        requestId: "req-core-turn-snapshot",
        createdAt: "2026-03-11T00:00:00.000Z",
        input: "",
        sessionKey: session.sessionKey,
        provider: "openai-codex",
        profileId: "default",
        runMode: "continue",
        withTools: false,
      },
      {
        sessionPort,
        stateStore,
      },
    );

    assert.equal(prepared.providerInput.preparedState.source, "snapshot");
    assert.equal(prepared.providerInput.requestContext.runMode, "continue");
    assert.equal(prepared.providerInput.requestContext.continueReason, "tool_result");
    assert.equal(prepared.providerInput.preparedState.initialMessages[0]?.role, "user");
    assert.equal(prepared.providerInput.preparedState.initialMessages[2]?.role, "toolResult");
    assert.equal(prepared.providerInput.requestContext.bootstrapMessages?.length ?? 0, 0);
  });
});

test("core turn ignores invalid snapshots and falls back to transcript history", async () => {
  await withTempHome(async () => {
    const sessionPort = createSessionAdapter();
    const stateStore = createAgentStateStore();
    const session = await sessionPort.resolveSession({
      sessionKey: "core-turn-transcript",
      provider: "openai-codex",
      profileId: "default",
    });

    await sessionPort.appendTurnMessages(
      session.sessionId,
      "transcript question",
      {
        route: "adapter.stub",
        stage: "adapter.stub.test",
        result: "transcript answer",
        provider: "openai-codex",
        profileId: "default",
      },
    );

    const legacyPath = stateStore.resolvePath(session.sessionKey);
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, JSON.stringify({
      version: 1,
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      provider: "openai-codex",
      profileId: "default",
      systemPrompt: "legacy",
      messages: [makeUserMessage("legacy user")],
      updatedAt: "2026-03-11T00:00:00.000Z",
    }, null, 2), "utf-8");

    const prepared = await prepareCoreTurn(
      {
        requestId: "req-core-turn-transcript",
        createdAt: "2026-03-11T00:00:00.000Z",
        input: "new prompt",
        sessionKey: session.sessionKey,
        provider: "openai-codex",
        profileId: "default",
        runMode: "continue",
        withTools: false,
      },
      {
        sessionPort,
        stateStore,
      },
    );

    assert.equal(prepared.providerInput.preparedState.source, "transcript");
    assert.equal(prepared.providerInput.requestContext.runMode, "prompt");
    assert.equal(prepared.providerInput.preparedState.initialMessages.length, 2);
    assert.equal(prepared.providerInput.preparedState.initialMessages[0]?.role, "user");
    assert.equal(prepared.providerInput.requestContext.bootstrapMessages?.length ?? 0, 2);
  });
});

test("core turn injects runtime paths and available skills into the system prompt", async () => {
  await withTempHome(async (home) => {
    const sessionPort = createSessionAdapter();
    const stateStore = createAgentStateStore();
    const paths = resolvePaths(home);

    const prepared = await prepareCoreTurn(
      {
        requestId: "req-core-turn-skills",
        createdAt: "2026-03-15T00:00:00.000Z",
        input: "请用 alpha123 skill 看一下今日空投和空投预告",
        sessionKey: "core-turn-skills",
        provider: "openai-codex",
        profileId: "default",
        withTools: true,
      },
      {
        sessionPort,
        stateStore,
      },
    );

    const systemPrompt = prepared.providerInput.requestContext.systemPrompt ?? "";
    assert.match(systemPrompt, /## Runtime Paths/);
    assert.match(systemPrompt, new RegExp(paths.workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(systemPrompt, new RegExp(paths.memory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(systemPrompt, /list_dir/);
    assert.match(systemPrompt, /glob/);
    assert.match(systemPrompt, /path_describe/);
    assert.match(systemPrompt, /## Skills/);
    assert.match(systemPrompt, /<available_skills>/);
    assert.match(systemPrompt, /alpha123-airdrop-digest/);
    assert.match(
      systemPrompt,
      new RegExp(resolveBuiltinSkillsDir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });
});

test("core turn rejects invalid continue from transcript-backed assistant tail", async () => {
  await withTempHome(async () => {
    const sessionPort = createSessionAdapter();
    const stateStore = createAgentStateStore();
    const session = await sessionPort.resolveSession({
      sessionKey: "core-turn-invalid-continue",
      provider: "openai-codex",
      profileId: "default",
    });

    await sessionPort.appendTurnMessages(
      session.sessionId,
      "finished task",
      {
        route: "adapter.stub",
        stage: "adapter.stub.test",
        result: "done",
        provider: "openai-codex",
        profileId: "default",
      },
    );

    await assert.rejects(
      () =>
        prepareCoreTurn(
          {
            requestId: "req-core-turn-invalid-continue",
            createdAt: "2026-03-11T00:00:00.000Z",
            input: "",
            sessionKey: session.sessionKey,
            provider: "openai-codex",
            profileId: "default",
            runMode: "continue",
            withTools: false,
          },
          {
            sessionPort,
            stateStore,
          },
        ),
      /Cannot continue from last message role: assistant/,
    );
  });
});

test("core turn commits transcript, snapshot, route and compaction in fixed order", async () => {
  const calls: string[] = [];
  let includeUserMessage: boolean | undefined;

  const sessionRecord: CoreSessionRecord = {
    sessionKey: "commit-session",
    sessionId: "commit-session-id",
    createdAt: "2026-03-11T00:00:00.000Z",
    updatedAt: "2026-03-11T00:00:00.000Z",
    isNewSession: false,
    memoryEnabled: true,
    compactedMessageCount: 0,
  };

  const sessionPort: CoreSessionPort = {
    resolveSession: async () => sessionRecord,
    loadTranscriptMessages: async () => [],
    loadMemorySnippet: async () => "",
    appendTurnMessages: async (_sessionId, _userInput, _finalResult, options) => {
      includeUserMessage = options?.includeUserMessage;
      calls.push("append");
    },
    markRouteUsage: async () => {
      calls.push("route");
    },
    compactIfNeeded: async () => {
      calls.push("compact");
      return true;
    },
    resolveSessionMemoryPath: () => "/tmp/commit-memory.md",
  };

  const stateStore = {
    load: async () => undefined,
    save: async () => {
      calls.push("snapshot");
    },
    clear: async () => undefined,
    resolvePath: () => "/tmp/commit-snapshot.json",
  };

  const preparedTurn: PreparedTurn = {
    session: sessionRecord,
    providerInput: {
      requestContext: {
        requestId: "req-commit",
        createdAt: "2026-03-11T00:00:00.000Z",
        input: "hello",
        sessionKey: sessionRecord.sessionKey,
        sessionId: sessionRecord.sessionId,
        provider: "openai-codex",
        profileId: "default",
        runMode: "prompt",
        memoryEnabled: true,
      },
      preparedState: {
        source: "new",
        initialMessages: [],
      },
      withTools: false,
    },
  };

  const runtimeResult: ProviderResult = {
    route: "adapter.openai-codex",
    stage: "adapter.openai-codex.test",
    result: "done",
    runMode: "prompt",
    provider: "openai-codex",
    profileId: "default",
    sessionState: {
      systemPrompt: "system",
      messages: [makeUserMessage("hello"), makeAssistantMessage("done")],
    },
  };

  const commitResult = await commitCoreTurn(
    {
      preparedTurn,
      runtimeResult,
    },
    {
      sessionPort,
      stateStore,
    },
  );

  assert.deepEqual(calls, ["append", "snapshot", "route", "compact"]);
  assert.equal(includeUserMessage, true);
  assert.equal(commitResult.memoryUpdated, true);
});
