import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

function getTextContent(message: Message): string {
  if (message.role !== "user") {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function makeAssistantMessage(
  content: Extract<Message, { role: "assistant" }>["content"],
  stopReason: StopReason = "stop",
): Message {
  return {
    role: "assistant",
    content: content as Extract<Message, { role: "assistant" }>["content"],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-codex",
    usage: makeUsageZero(),
    stopReason,
    timestamp: Date.now(),
  } as Message;
}

class ToolAwareFakeAgent implements SessionManagedAgent {
  public readonly state: {
    systemPrompt: string;
    messages: Message[];
  };

  public sessionId?: string;
  private tools: AgentTool<any>[];
  private readonly listeners = new Set<(event: AgentEvent) => void>();

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

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async prompt(message: Message): Promise<void> {
    this.state.messages.push(message);
    const input = getTextContent(message);

    if (input.includes("use tool") && this.tools[0]) {
      const tool = this.tools[0];
      const toolCallId = "tool-call-1";
      const toolArgs = {
        path: "output.txt",
        content: "hello from tool",
        createDir: true,
      };
      const toolCallMessage = makeAssistantMessage([
        { type: "toolCall", id: toolCallId, name: tool.name, arguments: toolArgs },
      ], "toolUse");
      this.state.messages.push(toolCallMessage);
      this.emit({
        type: "message_update",
        message: toolCallMessage,
        assistantMessageEvent: {
          type: "toolcall_end",
          contentIndex: 0,
          toolCall: toolCallMessage.content[0] as Extract<
            Extract<Message, { role: "assistant" }>["content"][number],
            { type: "toolCall" }
          >,
          partial: toolCallMessage as Extract<Message, { role: "assistant" }>,
        },
      });
      this.emit({ type: "message_end", message: toolCallMessage });

      const toolResult = await tool.execute(toolCallId, toolArgs, undefined);
      const toolResultMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId,
        toolName: tool.name,
        content: toolResult.content,
        details: toolResult.details,
        isError: false,
        timestamp: Date.now(),
      };
      this.state.messages.push(toolResultMessage as Message);
      this.emit({
        type: "turn_end",
        message: toolCallMessage,
        toolResults: [toolResultMessage],
      });

      const finalAssistant = makeAssistantMessage([
        { type: "text", text: "tool completed" },
        { type: "toolCall", id: toolCallId, name: tool.name, arguments: toolArgs },
      ]);
      this.state.messages.push(finalAssistant);
      this.emit({ type: "message_end", message: finalAssistant });
      return;
    }

    const assistantMessage = makeAssistantMessage([
      { type: "text", text: `echo:${input}` },
    ]);
    this.state.messages.push(assistantMessage);
    this.emit({ type: "message_end", message: assistantMessage });
  }

  async continue(): Promise<void> {
    const assistantMessage = makeAssistantMessage([
      { type: "text", text: "continued" },
    ]);
    this.state.messages.push(assistantMessage);
    this.emit({ type: "message_end", message: assistantMessage });
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function makeRequestContext(overrides: Partial<RequestContext>): RequestContext {
  return {
    requestId: "req-tool",
    createdAt: "2026-03-10T00:00:00.000Z",
    input: "please use tool now",
    sessionKey: "tool-session",
    sessionId: "tool-session-id",
    bootstrapMessages: [],
    contextMessageLimit: 12,
    provider: "openai-codex",
    profileId: "default",
    runMode: "prompt",
    ...overrides,
  };
}

test("codex adapter keeps tool execution working with session-managed agents", async () => {
  await withTempHome(async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "lainclaw-codex-tool-"));
    try {
      let createdAgentCount = 0;
      const stateStore = createAgentStateStore();
      const manager = createSessionAgentManager({
        stateStore,
        agentFactory: (input) => {
          createdAgentCount += 1;
          return new ToolAwareFakeAgent(input);
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

      const result = await runCodexAdapter({
        route: "adapter.openai-codex",
        withTools: true,
        cwd,
        toolSpecs: [
          {
            name: "write",
            description: "Write a file",
            inputSchema: {
              type: "object",
              required: ["path", "content"],
              properties: {
                path: { type: "string" },
                content: { type: "string" },
                createDir: { type: "boolean" },
              },
            },
          },
        ],
        requestContext: {
          ...makeRequestContext({}),
        },
      });

      const snapshot = await stateStore.load("tool-session");

      assert.equal(createdAgentCount, 1);
      assert.equal(result.provider, "openai-codex");
      assert.equal(result.profileId, "default");
      assert.equal(result.result, "tool completed");
      assert.equal(result.toolCalls?.length, 1);
      assert.equal(result.toolCalls?.[0]?.name, "write");
      assert.equal(result.toolResults?.length, 1);
      assert.equal(result.toolResults?.[0]?.result.ok, true);
      assert.equal(await fs.readFile(path.join(cwd, "output.txt"), "utf-8"), "hello from tool");
      assert.equal(snapshot?.messages.length, 4);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
