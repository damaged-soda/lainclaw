import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Message, Model } from "@mariozechner/pi-ai";
import {
  createSessionAgentManager,
  type SessionAgentFactoryInput,
  type SessionManagedAgent,
} from "../runtime/sessionAgentManager.js";
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

class FakeSessionAgent implements SessionManagedAgent {
  public readonly state: {
    systemPrompt: string;
    messages: Message[];
  };

  public sessionId?: string;
  private tools: AgentTool<any>[];

  constructor(input: SessionAgentFactoryInput) {
    this.state = {
      systemPrompt: input.initialState.systemPrompt,
      messages: [...input.initialState.messages],
    };
    this.sessionId = input.sessionId;
    this.tools = [...input.initialState.tools];
  }

  setSystemPrompt(value: string): void {
    this.state.systemPrompt = value;
  }

  setModel(_model: Model<any>): void {
    // test fake does not use the model.
  }

  setTools(tools: AgentTool<any>[]): void {
    this.tools = [...tools];
  }

  subscribe(): () => void {
    return () => undefined;
  }

  async prompt(message: Message): Promise<void> {
    this.state.messages.push(message);
    this.state.messages.push(makeAssistantMessage(`echo:${this.tools.length}:${String(message.content)}`));
  }

  async continue(): Promise<void> {
    this.state.messages.push(makeAssistantMessage(`continue:${this.tools.length}`));
  }
}

function makeRequestContext(
  overrides: Partial<RequestContext> & Pick<RequestContext, "sessionKey" | "sessionId">,
): RequestContext {
  return {
    requestId: "req-session-agent-manager",
    createdAt: "2026-03-11T00:00:00.000Z",
    input: "prompt",
    sessionKey: overrides.sessionKey,
    sessionId: overrides.sessionId,
    bootstrapMessages: [],
    contextMessageLimit: 12,
    provider: "openai-codex",
    profileId: "default",
    runMode: "prompt",
    memoryEnabled: true,
    ...overrides,
  };
}

test("session agent manager reuses the same agent instance within one process", async () => {
  const createdAgents: SessionManagedAgent[] = [];
  const manager = createSessionAgentManager({
    agentFactory: (input) => {
      const agent = new FakeSessionAgent(input);
      createdAgents.push(agent);
      return agent;
    },
  });
  const model = {} as Model<any>;
  let firstAgent: SessionManagedAgent | undefined;
  let secondAgent: SessionManagedAgent | undefined;
  let firstCache = "";
  let secondCache = "";

  await manager.run(
    {
      requestContext: makeRequestContext({
        sessionKey: "reuse-session",
        sessionId: "session-1",
        input: "first",
      }),
      systemPrompt: "system",
      initialState: {
        source: "new",
        systemPrompt: "system",
        messages: [makeUserMessage("history")],
      },
      model,
      tools: [],
      convertToLlm: async (messages) => messages as Message[],
    },
    async (agent, context) => {
      firstAgent = agent;
      firstCache = context.cache;
      await agent.prompt(makeUserMessage("first"));
    },
  );

  const secondRun = await manager.run(
    {
      requestContext: makeRequestContext({
        sessionKey: "reuse-session",
        sessionId: "session-1",
        input: "second",
      }),
      systemPrompt: "system",
      initialState: {
        source: "snapshot",
        systemPrompt: "stale-system",
        messages: [makeUserMessage("should-not-replay")],
      },
      model,
      tools: [],
      convertToLlm: async (messages) => messages as Message[],
    },
    async (agent, context) => {
      secondAgent = agent;
      secondCache = context.cache;
      assert.equal((agent.state.messages as Message[]).length, 3);
      await agent.prompt(makeUserMessage("second"));
    },
  );

  assert.equal(createdAgents.length, 1);
  assert.equal(firstCache, "miss");
  assert.equal(secondCache, "hit");
  assert.equal(firstAgent, secondAgent);
  assert.equal(secondRun.sessionState.messages.length, 5);
  assert.equal(secondRun.sessionState.systemPrompt, "system");
});

test("session agent manager consumes caller-provided restore state on cache miss", async () => {
  const model = {} as Model<any>;
  const manager1 = createSessionAgentManager({
    agentFactory: (input) => new FakeSessionAgent(input),
  });
  const firstRun = await manager1.run(
    {
      requestContext: makeRequestContext({
        sessionKey: "restore-session",
        sessionId: "session-restore",
        input: "first turn",
      }),
      systemPrompt: "system",
      initialState: {
        source: "new",
        systemPrompt: "system",
        messages: [],
      },
      model,
      tools: [],
      convertToLlm: async (messages) => messages as Message[],
    },
    async (agent) => {
      await agent.prompt(makeUserMessage("first turn"));
    },
  );

  const manager2 = createSessionAgentManager({
    agentFactory: (input) => new FakeSessionAgent(input),
  });
  let restoredCache = "";

  const restoredRun = await manager2.run(
    {
      requestContext: makeRequestContext({
        sessionKey: "restore-session",
        sessionId: "session-restore",
        input: "second turn",
      }),
      systemPrompt: "system",
      initialState: {
        source: "snapshot",
        systemPrompt: firstRun.sessionState.systemPrompt,
        messages: firstRun.sessionState.messages,
      },
      model,
      tools: [],
      convertToLlm: async (messages) => messages as Message[],
    },
    async (agent, context) => {
      restoredCache = context.cache;
      assert.equal((agent.state.messages as Message[]).length, 2);
      await agent.prompt(makeUserMessage("second turn"));
    },
  );

  assert.equal(restoredCache, "miss");
  assert.equal(restoredRun.sessionState.messages.length, 4);
  assert.equal(restoredRun.sessionState.messages[0]?.role, "user");
  assert.equal(restoredRun.sessionState.messages[2]?.role, "user");
});
