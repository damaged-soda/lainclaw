import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentEvent, AgentMessage, AgentTool } from "@mariozechner/pi-agent-core";
import { getModel, type Message, type Model, type StopReason, type ToolResultMessage } from "@mariozechner/pi-ai";
import { getOpenAICodexApiContext } from "../auth/authManager.js";
import { createRunCodexAdapter } from "../providers/codexAdapter.js";
import { createAgentStateStore, type AgentStateSnapshot } from "../runtime/agentStateStore.js";
import {
  createSessionAgentManager,
  type SessionAgentFactoryInput,
  type SessionManagedAgent,
} from "../runtime/sessionAgentManager.js";
import { MEMORY_CONTEXT_PREFIX } from "../runtime/context.js";
import { withTempHome } from "./helpers.js";
import type { RequestContext } from "../shared/types.js";

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

function makeAssistantMessage(
  content: string,
  stopReason: StopReason = "stop",
): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text: content }],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-codex",
    usage: makeUsageZero(),
    stopReason,
    timestamp: Date.now(),
  } as Message;
}

function makeToolResultMessage(
  toolCallId: string,
  toolName: string,
  text: string,
): ToolResultMessage {
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

class TransformAwareEventAgent implements SessionManagedAgent {
  public readonly state: {
    systemPrompt: string;
    messages: Message[];
  };

  public sessionId?: string;
  public readonly transformedContexts: AgentMessage[][] = [];
  public readonly calls: Array<"prompt" | "continue"> = [];

  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private readonly transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  private tools: AgentTool<any>[];

  constructor(input: SessionAgentFactoryInput) {
    this.state = {
      systemPrompt: input.initialState.systemPrompt,
      messages: [...input.initialState.messages],
    };
    this.sessionId = input.sessionId;
    this.tools = [...input.initialState.tools];
    this.transformContext = input.transformContext;
  }

  setSystemPrompt(value: string): void {
    this.state.systemPrompt = value;
  }

  setModel(_model: Model<any>): void {
    // The test fake does not call models.
  }

  setTools(tools: AgentTool<any>[]): void {
    this.tools = [...tools];
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async prompt(message: Message): Promise<void> {
    this.calls.push("prompt");
    await this.captureTransformPreview([...this.state.messages, message]);
    this.state.messages.push(message);
    const assistant = makeAssistantMessage(`prompt:${this.tools.length}`);
    this.state.messages.push(assistant);
    this.emit({ type: "message_end", message: assistant });
  }

  async continue(): Promise<void> {
    this.calls.push("continue");
    await this.captureTransformPreview(this.state.messages);
    const assistant = makeAssistantMessage("continued");
    this.state.messages.push(assistant);
    this.emit({ type: "message_end", message: assistant });
  }

  private async captureTransformPreview(messages: Message[]): Promise<void> {
    const transformed = this.transformContext
      ? await this.transformContext(messages as AgentMessage[])
      : messages;
    this.transformedContexts.push(transformed);
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function makeRequestContext(overrides: Partial<RequestContext>): RequestContext {
  return {
    requestId: "req-phase3",
    createdAt: "2026-03-11T00:00:00.000Z",
    input: "latest input",
    sessionKey: "phase3-session",
    sessionId: "phase3-session-id",
    bootstrapMessages: [],
    contextMessageLimit: 12,
    provider: "openai-codex",
    profileId: "default",
    runMode: "prompt",
    memoryEnabled: true,
    ...overrides,
  };
}

function makeSnapshot(
  sessionKey: string,
  sessionId: string,
  messages: Message[],
): AgentStateSnapshot {
  return {
    version: 2,
    sessionKey,
    sessionId,
    provider: "openai-codex",
    profileId: "default",
    systemPrompt: "system",
    messages,
    updatedAt: "2026-03-11T00:00:00.000Z",
  };
}

async function createPhase3Harness() {
  const stateStore = createAgentStateStore();
  const createdAgents: TransformAwareEventAgent[] = [];
  const manager = createSessionAgentManager({
    stateStore,
    agentFactory: (input) => {
      const agent = new TransformAwareEventAgent(input);
      createdAgents.push(agent);
      return agent;
    },
  });
  const fakeGetApiContext: typeof getOpenAICodexApiContext = async () =>
    ({
      apiKey: "test-key",
      profile: {
        id: "default",
      },
    }) as Awaited<ReturnType<typeof getOpenAICodexApiContext>>;
  const fakeGetModel: typeof getModel = () => ({} as Model<any>);
  const runCodexAdapter = createRunCodexAdapter({
    sessionAgentManager: manager,
    getApiContextFn: fakeGetApiContext,
    getModelFn: fakeGetModel,
  });

  return {
    stateStore,
    createdAgents,
    runCodexAdapter,
  };
}

test("codex adapter keeps new user follow-up on prompt even when continue was requested", async () => {
  await withTempHome(async () => {
    const { stateStore, createdAgents, runCodexAdapter } = await createPhase3Harness();
    await stateStore.save(makeSnapshot(
      "phase3-follow-up",
      "phase3-follow-up-id",
      [
        makeUserMessage("existing user"),
        makeAssistantMessage("existing assistant"),
      ],
    ));

    const result = await runCodexAdapter({
      route: "adapter.openai-codex",
      withTools: false,
      requestContext: makeRequestContext({
        input: "new follow-up",
        sessionKey: "phase3-follow-up",
        sessionId: "phase3-follow-up-id",
        runMode: "continue",
      }),
    });

    assert.equal(result.runMode, "prompt");
    assert.equal(createdAgents[0]?.calls[0], "prompt");
  });
});

test("codex adapter continues restored toolResult state without a new user message", async () => {
  await withTempHome(async () => {
    const { stateStore, createdAgents, runCodexAdapter } = await createPhase3Harness();
    await stateStore.save(makeSnapshot(
      "phase3-continue",
      "phase3-continue-id",
      [
        makeUserMessage("run tool"),
        makeAssistantMessage("calling tool", "toolUse"),
        makeToolResultMessage("tool-1", "write", "done") as Message,
      ],
    ));

    const result = await runCodexAdapter({
      route: "adapter.openai-codex",
      withTools: false,
      requestContext: makeRequestContext({
        input: "",
        sessionKey: "phase3-continue",
        sessionId: "phase3-continue-id",
        runMode: "continue",
      }),
    });

    assert.equal(result.runMode, "continue");
    assert.equal(result.continueReason, "restore_resume");
    assert.equal(result.result, "continued");
    assert.equal(createdAgents[0]?.calls[0], "continue");
  });
});

test("codex adapter rejects continue when the last message is assistant", async () => {
  await withTempHome(async () => {
    const { stateStore, runCodexAdapter } = await createPhase3Harness();
    await stateStore.save(makeSnapshot(
      "phase3-continue-fail",
      "phase3-continue-fail-id",
      [
        makeUserMessage("finished task"),
        makeAssistantMessage("done"),
      ],
    ));

    await assert.rejects(
      () =>
        runCodexAdapter({
          route: "adapter.openai-codex",
          withTools: false,
          requestContext: makeRequestContext({
            input: "",
            sessionKey: "phase3-continue-fail",
            sessionId: "phase3-continue-fail-id",
            runMode: "continue",
          }),
        }),
      /Cannot continue from last message role: assistant/,
    );
  });
});

test("older snapshot versions are ignored instead of being partially cleaned", async () => {
  await withTempHome(async () => {
    const { stateStore, createdAgents, runCodexAdapter } = await createPhase3Harness();
    const legacyPath = stateStore.resolvePath("phase3-legacy-snapshot");
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, JSON.stringify({
      version: 1,
      sessionKey: "phase3-legacy-snapshot",
      sessionId: "phase3-legacy-snapshot-id",
      provider: "openai-codex",
      profileId: "default",
      systemPrompt: "legacy",
      messages: [makeUserMessage("legacy user")],
      updatedAt: "2026-03-11T00:00:00.000Z",
    }, null, 2), "utf-8");

    await runCodexAdapter({
      route: "adapter.openai-codex",
      withTools: false,
      requestContext: makeRequestContext({
        input: "new prompt",
        sessionKey: "phase3-legacy-snapshot",
        sessionId: "phase3-legacy-snapshot-id",
        bootstrapMessages: [makeUserMessage("transcript bootstrap")],
      }),
    });

    const transformed = createdAgents[0]?.transformedContexts[0] ?? [];
    const transformedText = transformed
      .filter((message) => message.role === "user" && typeof message.content === "string")
      .map((message) => message.content);

    assert.ok(transformedText.includes("transcript bootstrap"));
    assert.ok(!transformedText.includes("legacy user"));
  });
});

test("transformContext trims long transcript fallback to the configured context window", async () => {
  await withTempHome(async () => {
    const { createdAgents, runCodexAdapter } = await createPhase3Harness();
    const transcriptMessages = Array.from({ length: 20 }, (_, index) => ({
      id: `msg-${index + 1}`,
      role: "user" as const,
      timestamp: "2026-03-11T00:00:00.000Z",
      content: `history-${index + 1}`,
    }));

    const result = await runCodexAdapter({
      route: "adapter.openai-codex",
      withTools: false,
      requestContext: makeRequestContext({
        input: "latest input",
        sessionKey: "phase3-trim",
        sessionId: "phase3-trim-id",
        bootstrapMessages: transcriptMessages.map((message) => makeUserMessage(message.content)),
      }),
    });

    const transformed = createdAgents[0]?.transformedContexts[0] ?? [];
    const transformedText = transformed.map((message) => {
      if (message.role === "context_memory") {
        return message.content;
      }
      if (message.role === "assistant") {
        return (message.content[0] as { text: string }).text;
      }
      return typeof message.content === "string"
        ? message.content
        : message.content.map((block) => ("text" in block ? block.text : "")).join("");
    });

    assert.equal(result.runMode, "prompt");
    assert.equal(transformed.length, 12);
    assert.deepEqual(transformedText, [
      "history-10",
      "history-11",
      "history-12",
      "history-13",
      "history-14",
      "history-15",
      "history-16",
      "history-17",
      "history-18",
      "history-19",
      "history-20",
      "latest input",
    ]);
  });
});

test("memory is injected only through transformContext and snapshot state wins over transcript fallback", async () => {
  await withTempHome(async () => {
    const { stateStore, createdAgents, runCodexAdapter } = await createPhase3Harness();
    await stateStore.save(makeSnapshot(
      "phase3-memory",
      "phase3-memory-id",
      [
        makeUserMessage("snapshot user"),
        makeAssistantMessage("snapshot assistant"),
      ],
    ));

    await runCodexAdapter({
      route: "adapter.openai-codex",
      withTools: false,
      requestContext: makeRequestContext({
        input: "follow up",
        sessionKey: "phase3-memory",
        sessionId: "phase3-memory-id",
        bootstrapMessages: [makeUserMessage("transcript fallback")],
        memorySnippet: "fresh summary",
      }),
    });

    const agent = createdAgents[0];
    const transformed = agent?.transformedContexts[0] ?? [];
    const memoryMessages = transformed.filter(
      (message) => message.role === "context_memory" && typeof message.content === "string",
    );
    const persistedMemoryMessages = agent?.state.messages.filter(
      (message) => message.role === "user" && typeof message.content === "string" && message.content.startsWith(MEMORY_CONTEXT_PREFIX),
    ) ?? [];
    const transformedText = transformed
      .filter((message) => message.role === "user" && typeof message.content === "string")
      .map((message) => message.content);

    assert.equal(memoryMessages.length, 1);
    assert.equal(memoryMessages[0]?.content, "fresh summary");
    assert.equal(persistedMemoryMessages.length, 0);
    assert.ok(transformedText.includes("snapshot user"));
    assert.ok(!transformedText.includes("transcript fallback"));
  });
});

test("reused session agents clear stale optional context fields between turns", async () => {
  await withTempHome(async () => {
    const { createdAgents, runCodexAdapter } = await createPhase3Harness();

    await runCodexAdapter({
      route: "adapter.openai-codex",
      withTools: false,
      requestContext: makeRequestContext({
        input: "first follow up",
        sessionKey: "phase3-stale-context",
        sessionId: "phase3-stale-context-id",
        memorySnippet: "first summary",
      }),
    });

    await runCodexAdapter({
      route: "adapter.openai-codex",
      withTools: false,
      requestContext: makeRequestContext({
        input: "second follow up",
        sessionKey: "phase3-stale-context",
        sessionId: "phase3-stale-context-id",
      }),
    });

    const transformedContexts = createdAgents[0]?.transformedContexts ?? [];
    const firstMemoryMessages = transformedContexts[0]?.filter(
      (message) => message.role === "context_memory" && message.content === "first summary",
    ) ?? [];
    const secondMemoryMessages = transformedContexts[1]?.filter(
      (message) => message.role === "context_memory",
    ) ?? [];

    assert.equal(createdAgents.length, 1);
    assert.equal(firstMemoryMessages.length, 1);
    assert.equal(secondMemoryMessages.length, 0);
  });
});
