import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentEvent, AgentTool } from "@mariozechner/pi-agent-core";
import { getModel, type Message, type Model, type StopReason, type ToolResultMessage } from "@mariozechner/pi-ai";
import { getOpenAICodexApiContext } from "../auth/authManager.js";
import { createRunCodexAdapter } from "../providers/codexAdapter.js";
import { createAgentStateStore } from "../runtime/agentStateStore.js";
import {
  createSessionAgentManager,
  type SessionAgentFactoryInput,
  type SessionManagedAgent,
} from "../runtime/sessionAgentManager.js";
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

function makeAssistantMessage(
  content: Extract<Message, { role: "assistant" }>["content"],
  stopReason: StopReason,
): Message {
  return {
    role: "assistant",
    content,
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
  isError: boolean,
  durationMs: number,
  canonicalToolName: string,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    details: {
      meta: {
        tool: canonicalToolName,
        durationMs,
      },
    },
    isError,
    timestamp: Date.now(),
  };
}

type ScriptedConversation = {
  persistedMessages: Message[];
  events: AgentEvent[];
};

class ScriptedEventAgent implements SessionManagedAgent {
  public readonly state: {
    systemPrompt: string;
    messages: Message[];
  };

  public sessionId?: string;
  private tools: AgentTool<any>[];
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private readonly script: (message: Message) => ScriptedConversation;

  constructor(
    input: SessionAgentFactoryInput,
    script: (message: Message) => ScriptedConversation,
  ) {
    this.state = {
      systemPrompt: input.initialState.systemPrompt,
      messages: [...input.initialState.messages],
    };
    this.sessionId = input.sessionId;
    this.tools = [...input.initialState.tools];
    this.script = script;
  }

  setSystemPrompt(value: string): void {
    this.state.systemPrompt = value;
  }

  setModel(_model: Model<any>): void {
    // The scripted test agent does not use models.
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
    const { persistedMessages, events } = this.script(message);
    this.state.messages.push(...persistedMessages);
    for (const event of events) {
      this.emit(event);
    }
  }

  async continue(): Promise<void> {
    const lastMessage = this.state.messages[this.state.messages.length - 1] as Message | undefined;
    const seedMessage = lastMessage && lastMessage.role !== "assistant"
      ? lastMessage
      : ({
          role: "user",
          content: "continue",
          timestamp: Date.now(),
        } as Message);
    const { persistedMessages, events } = this.script(seedMessage);
    this.state.messages.push(...persistedMessages.slice(1));
    for (const event of events) {
      this.emit(event);
    }
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function makeRequestContext(overrides: Partial<RequestContext>): RequestContext {
  return {
    requestId: "req-event",
    createdAt: "2026-03-11T00:00:00.000Z",
    input: "prompt",
    sessionKey: "event-session",
    sessionId: "event-session-id",
    transcriptMessages: [],
    contextMessageLimit: 12,
    provider: "openai-codex",
    profileId: "default",
    runMode: "prompt",
    ...overrides,
  };
}

function buildSuccessfulToolConversation(message: Message, runtimeToolName: string): ScriptedConversation {
  const userMessage = message;
  const toolCallId = "tool-call-success";
  const toolArgs = {
    path: "output.txt",
    content: "hello from event flow",
  };
  const assistantToolCall = makeAssistantMessage([
    {
      type: "toolCall",
      id: toolCallId,
      name: runtimeToolName,
      arguments: toolArgs,
    },
  ], "toolUse");
  const toolResult = makeToolResultMessage(
    toolCallId,
    runtimeToolName,
    "Wrote output.txt",
    false,
    12,
    "write file",
  );
  const finalAssistant = makeAssistantMessage([
    { type: "text", text: "completed via event flow" },
  ], "stop");

  return {
    persistedMessages: [userMessage, assistantToolCall, toolResult as Message, finalAssistant],
    events: [
      { type: "agent_start" },
      { type: "turn_start" },
      { type: "message_start", message: userMessage },
      { type: "message_end", message: userMessage },
      { type: "message_start", message: assistantToolCall },
      {
        type: "message_update",
        message: assistantToolCall,
        assistantMessageEvent: {
          type: "toolcall_end",
          contentIndex: 0,
          toolCall: assistantToolCall.content[0] as Extract<
            Extract<Message, { role: "assistant" }>["content"][number],
            { type: "toolCall" }
          >,
          partial: assistantToolCall as Extract<Message, { role: "assistant" }>,
        },
      },
      { type: "message_end", message: assistantToolCall },
      {
        type: "tool_execution_start",
        toolCallId,
        toolName: runtimeToolName,
        args: toolArgs,
      },
      {
        type: "tool_execution_update",
        toolCallId,
        toolName: runtimeToolName,
        args: toolArgs,
        partialResult: {
          content: [{ type: "text", text: "writing..." }],
          details: {
            meta: {
              tool: "write file",
              durationMs: 4,
            },
          },
        },
      },
      {
        type: "tool_execution_end",
        toolCallId,
        toolName: runtimeToolName,
        result: {
          content: [{ type: "text", text: "Wrote output.txt" }],
          details: {
            meta: {
              tool: "write file",
              durationMs: 12,
            },
          },
        },
        isError: false,
      },
      { type: "message_start", message: toolResult },
      { type: "message_end", message: toolResult },
      {
        type: "turn_end",
        message: assistantToolCall,
        toolResults: [toolResult],
      },
      { type: "turn_start" },
      { type: "message_start", message: finalAssistant },
      {
        type: "message_update",
        message: finalAssistant,
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "completed via event flow",
          partial: finalAssistant as Extract<Message, { role: "assistant" }>,
        },
      },
      { type: "message_end", message: finalAssistant },
      {
        type: "turn_end",
        message: finalAssistant,
        toolResults: [],
      },
      {
        type: "agent_end",
        messages: [userMessage, assistantToolCall, toolResult as Message, finalAssistant],
      },
    ],
  };
}

function buildFailingToolConversation(message: Message, runtimeToolName: string): ScriptedConversation {
  const userMessage = message;
  const toolCallId = "tool-call-failure";
  const toolArgs = {
    command: "rm -rf /tmp/protected",
  };
  const assistantToolCall = makeAssistantMessage([
    {
      type: "toolCall",
      id: toolCallId,
      name: runtimeToolName,
      arguments: toolArgs,
    },
  ], "toolUse");
  const toolResult = makeToolResultMessage(
    toolCallId,
    runtimeToolName,
    "permission denied",
    true,
    3,
    "shell exec",
  );
  const finalAssistant = makeAssistantMessage([
    { type: "text", text: "tool failed gracefully" },
  ], "stop");

  return {
    persistedMessages: [userMessage, assistantToolCall, toolResult as Message, finalAssistant],
    events: [
      { type: "agent_start" },
      { type: "turn_start" },
      { type: "message_start", message: userMessage },
      { type: "message_end", message: userMessage },
      { type: "message_start", message: assistantToolCall },
      {
        type: "message_update",
        message: assistantToolCall,
        assistantMessageEvent: {
          type: "toolcall_end",
          contentIndex: 0,
          toolCall: assistantToolCall.content[0] as Extract<
            Extract<Message, { role: "assistant" }>["content"][number],
            { type: "toolCall" }
          >,
          partial: assistantToolCall as Extract<Message, { role: "assistant" }>,
        },
      },
      { type: "message_end", message: assistantToolCall },
      {
        type: "tool_execution_start",
        toolCallId,
        toolName: runtimeToolName,
        args: toolArgs,
      },
      {
        type: "tool_execution_update",
        toolCallId,
        toolName: runtimeToolName,
        args: toolArgs,
        partialResult: {
          content: [{ type: "text", text: "permission denied" }],
          details: {
            meta: {
              tool: "shell exec",
              durationMs: 2,
            },
          },
        },
      },
      {
        type: "tool_execution_end",
        toolCallId,
        toolName: runtimeToolName,
        result: {
          content: [{ type: "text", text: "permission denied" }],
          details: {
            meta: {
              tool: "shell exec",
              durationMs: 3,
            },
          },
        },
        isError: true,
      },
      { type: "message_start", message: toolResult },
      { type: "message_end", message: toolResult },
      {
        type: "turn_end",
        message: assistantToolCall,
        toolResults: [toolResult],
      },
      { type: "turn_start" },
      { type: "message_start", message: finalAssistant },
      {
        type: "message_update",
        message: finalAssistant,
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "tool failed gracefully",
          partial: finalAssistant as Extract<Message, { role: "assistant" }>,
        },
      },
      { type: "message_end", message: finalAssistant },
      {
        type: "turn_end",
        message: finalAssistant,
        toolResults: [],
      },
      {
        type: "agent_end",
        messages: [userMessage, assistantToolCall, toolResult as Message, finalAssistant],
      },
    ],
  };
}

test("codex adapter uses AgentEvent order and event-derived tool state for successful tool turns", async () => {
  await withTempHome(async () => {
    const observedEvents: string[] = [];
    const stateStore = createAgentStateStore();
    const manager = createSessionAgentManager({
      stateStore,
      agentFactory: (input) => new ScriptedEventAgent(input, (message) =>
        buildSuccessfulToolConversation(message, "write_file")),
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

    const result = await runCodexAdapter({
      route: "adapter.openai-codex",
      withTools: true,
      toolSpecs: [
        {
          name: "write file",
          description: "Write a file",
          inputSchema: {
            type: "object",
            required: ["path", "content"],
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
          },
        },
      ],
      onAgentEvent: async (runtimeAgentEvent) => {
        observedEvents.push(runtimeAgentEvent.event.type);
      },
      requestContext: {
        ...makeRequestContext({
          requestId: "req-event-success",
          input: "please write the file",
          sessionKey: "event-success-session",
          sessionId: "event-success-session-id",
        }),
      },
    });

    const snapshot = await stateStore.load("event-success-session");

    assert.deepEqual(observedEvents, [
      "agent_start",
      "turn_start",
      "message_start",
      "message_end",
      "message_start",
      "message_update",
      "message_end",
      "tool_execution_start",
      "tool_execution_update",
      "tool_execution_end",
      "message_start",
      "message_end",
      "turn_end",
      "turn_start",
      "message_start",
      "message_update",
      "message_end",
      "turn_end",
      "agent_end",
    ]);
    assert.equal(result.result, "completed via event flow");
    assert.equal(result.stopReason, "stop");
    assert.equal(result.toolCalls?.length, 1);
    assert.equal(result.toolCalls?.[0]?.name, "write file");
    assert.deepEqual(result.toolCalls?.[0]?.args, {
      path: "output.txt",
      content: "hello from event flow",
    });
    assert.equal(result.toolResults?.length, 1);
    assert.equal(result.toolResults?.[0]?.result.ok, true);
    assert.equal(result.toolResults?.[0]?.result.content, "Wrote output.txt");
    assert.equal(result.toolResults?.[0]?.result.meta?.durationMs, 12);
    assert.equal(snapshot?.messages.length, 4);
  });
});

test("codex adapter accumulates tool failures from AgentEvent without relying on final response parsing", async () => {
  await withTempHome(async () => {
    const stateStore = createAgentStateStore();
    const manager = createSessionAgentManager({
      stateStore,
      agentFactory: (input) => new ScriptedEventAgent(input, (message) =>
        buildFailingToolConversation(message, "shell_exec")),
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

    const result = await runCodexAdapter({
      route: "adapter.openai-codex",
      withTools: true,
      toolSpecs: [
        {
          name: "shell exec",
          description: "Run a shell command",
          inputSchema: {
            type: "object",
            required: ["command"],
            properties: {
              command: { type: "string" },
            },
          },
        },
      ],
      requestContext: {
        ...makeRequestContext({
          requestId: "req-event-failure",
          input: "run the protected command",
          sessionKey: "event-failure-session",
          sessionId: "event-failure-session-id",
        }),
      },
    });

    assert.equal(result.result, "tool failed gracefully");
    assert.equal(result.stopReason, "stop");
    assert.equal(result.toolCalls?.length, 1);
    assert.equal(result.toolCalls?.[0]?.name, "shell exec");
    assert.deepEqual(result.toolCalls?.[0]?.args, {
      command: "rm -rf /tmp/protected",
    });
    assert.equal(result.toolResults?.length, 1);
    assert.equal(result.toolResults?.[0]?.result.ok, false);
    assert.equal(result.toolResults?.[0]?.result.error?.tool, "shell exec");
    assert.equal(result.toolResults?.[0]?.result.error?.message, "permission denied");
    assert.equal(result.toolResults?.[0]?.result.meta?.durationMs, 3);
  });
});
