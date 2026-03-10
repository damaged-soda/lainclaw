import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Message, Model } from "@mariozechner/pi-ai";
import { createAgentStateStore } from "../runtime/agentStateStore.js";
import {
  createSessionAgentManager,
  type SessionAgentFactoryInput,
  type SessionManagedAgent,
} from "../runtime/sessionAgentManager.js";
import { withTempHome } from "./helpers.js";

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
}

test("session agent manager reuses the same agent instance within one process", async () => {
  await withTempHome(async () => {
    const stateStore = createAgentStateStore();
    const createdAgents: SessionManagedAgent[] = [];
    const manager = createSessionAgentManager({
      stateStore,
      agentFactory: (input) => {
        const agent = new FakeSessionAgent(input);
        createdAgents.push(agent);
        return agent;
      },
    });
    const model = {} as Model<any>;
    let firstAgent: SessionManagedAgent | undefined;
    let secondAgent: SessionManagedAgent | undefined;
    let firstSource = "";
    let secondSource = "";

    await manager.runWithSessionAgent(
      {
        sessionKey: "reuse-session",
        sessionId: "session-1",
        provider: "openai-codex",
        profileId: "default",
        systemPrompt: "system",
        model,
        tools: [],
        initialMessages: [makeUserMessage("history")],
        convertToLlm: async (messages) => messages as Message[],
      },
      async (agent, context) => {
        firstAgent = agent;
        firstSource = context.source;
        await agent.prompt(makeUserMessage("first"));
      },
    );

    await manager.runWithSessionAgent(
      {
        sessionKey: "reuse-session",
        sessionId: "session-1",
        provider: "openai-codex",
        profileId: "default",
        systemPrompt: "system",
        model,
        tools: [],
        initialMessages: [makeUserMessage("should-not-replay")],
        convertToLlm: async (messages) => messages as Message[],
      },
      async (agent, context) => {
        secondAgent = agent;
        secondSource = context.source;
        assert.equal((agent.state.messages as Message[]).length, 3);
        await agent.prompt(makeUserMessage("second"));
      },
    );

    const snapshot = await stateStore.load("reuse-session");

    assert.equal(createdAgents.length, 1);
    assert.equal(firstSource, "new");
    assert.equal(secondSource, "memory");
    assert.equal(firstAgent, secondAgent);
    assert.equal(snapshot?.messages.length, 5);
    assert.equal(snapshot?.sessionId, "session-1");
  });
});

test("session agent manager restores persisted snapshots after restart", async () => {
  await withTempHome(async () => {
    const stateStore = createAgentStateStore();
    const model = {} as Model<any>;
    let restoredSource = "";

    const manager1 = createSessionAgentManager({
      stateStore,
      agentFactory: (input) => new FakeSessionAgent(input),
    });
    await manager1.runWithSessionAgent(
      {
        sessionKey: "restore-session",
        sessionId: "session-restore",
        provider: "openai-codex",
        profileId: "default",
        systemPrompt: "system",
        model,
        tools: [],
        initialMessages: [],
        convertToLlm: async (messages) => messages as Message[],
      },
      async (agent) => {
        await agent.prompt(makeUserMessage("first turn"));
      },
    );

    const manager2 = createSessionAgentManager({
      stateStore,
      agentFactory: (input) => new FakeSessionAgent(input),
    });
    await manager2.runWithSessionAgent(
      {
        sessionKey: "restore-session",
        sessionId: "session-restore",
        provider: "openai-codex",
        profileId: "default",
        systemPrompt: "system",
        model,
        tools: [],
        initialMessages: [makeUserMessage("fallback-history")],
        convertToLlm: async (messages) => messages as Message[],
      },
      async (agent, context) => {
        restoredSource = context.source;
        assert.equal((agent.state.messages as Message[]).length, 2);
        await agent.prompt(makeUserMessage("second turn"));
      },
    );

    const snapshot = await stateStore.load("restore-session");

    assert.equal(restoredSource, "snapshot");
    assert.equal(snapshot?.messages.length, 4);
    assert.equal(snapshot?.messages[0]?.role, "user");
    assert.equal(snapshot?.messages[2]?.role, "user");
  });
});
