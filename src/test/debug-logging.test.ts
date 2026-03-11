import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@mariozechner/pi-ai";
import { buildRuntimeRequestContext } from "../runtime/context.js";
import { buildCodexDebugRequestSnapshot } from "../providers/codexDebug.js";
import { buildDebugObservationContent } from "../shared/debug.js";

async function captureStdout<T>(fn: () => T | Promise<T>): Promise<{ output: string; result: T }> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let output = "";

  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;

  try {
    const result = await fn();
    return { output, result };
  } finally {
    process.stdout.write = originalWrite;
  }
}

test("runtime context no longer emits stdout debug logs when debug is enabled", async () => {
  const { output, result } = await captureStdout(() =>
    Promise.resolve(buildRuntimeRequestContext({
      requestId: "req-debug",
      createdAt: "2026-03-10T00:00:00.000Z",
      input: "latest input",
      sessionKey: "session-debug",
      sessionId: "session-id-debug",
      bootstrapMessages: [
        {
          id: "msg-1",
          role: "user",
          timestamp: "2026-03-10T00:00:00.000Z",
          content: "previous input",
        },
      ],
      memorySnippet: "remember this",
      provider: "openai-codex",
      profileId: "default",
      withTools: true,
      tools: [],
      runMode: "prompt",
      memoryEnabled: true,
      debug: true,
    })),
  );

  assert.equal(result.requestContext.debug, true);
  assert.equal(result.requestContext.bootstrapMessages?.length, 1);
  assert.equal(result.requestContext.bootstrapMessages?.[0]?.role, "user");
  assert.equal(result.requestContext.memorySnippet, "remember this");
  assert.equal(result.promptMessage?.role, "user");
  assert.equal(
    typeof result.requestContext.bootstrapMessages?.[0]?.content === "string"
      ? result.requestContext.bootstrapMessages?.[0]?.content
      : "",
    "previous input",
  );
  assert.equal(
    typeof result.promptMessage?.content === "string"
      ? result.promptMessage?.content
      : "",
    "latest input",
  );
  assert.equal(output, "");
});

test("codex debug snapshot includes the final pi-agent-core request payload", () => {
  const messages: Message[] = [
    {
      role: "user",
      content: "history",
      timestamp: Date.now(),
    } as Message,
  ];
  const prompt: Message = {
    role: "user",
    content: "final input",
    timestamp: Date.now(),
  } as Message;

  const snapshot = buildCodexDebugRequestSnapshot({
    systemPrompt: "system prompt",
    modelName: "gpt-codex",
    messages,
    tools: [
      {
        name: "read",
        description: "Read a file",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
    prompt,
  });

  assert.equal(snapshot.initialState.systemPrompt, "system prompt");
  assert.equal(snapshot.initialState.model, "gpt-codex");
  assert.equal(snapshot.initialState.messages, messages);
  assert.equal(snapshot.prompt, prompt);
  assert.equal(snapshot.initialState.tools?.[0]?.name, "read");
});

test("debug log observation promotes the most important field out of metadata", () => {
  const observation = buildDebugObservationContent("provider.codex.system_prompt_attached", {
    requestId: "req-debug",
    sessionKey: "session-debug",
    provider: "openai-codex",
    profileId: "default",
    source: "default",
    systemPrompt: "You are a concise and reliable coding assistant.",
  });

  assert.equal(
    observation.input,
    "You are a concise and reliable coding assistant.",
  );
  assert.equal(observation.output, undefined);
  assert.deepEqual(observation.metadata, {
    requestId: "req-debug",
    sessionKey: "session-debug",
    provider: "openai-codex",
    profileId: "default",
    source: "default",
  });
});

test("debug log observation promotes state-style payloads into input", () => {
  const observation = buildDebugObservationContent("runtime.agent.session.bound", {
    sessionKey: "session-debug",
    sessionId: "session-id-debug",
    provider: "openai-codex",
    source: "new",
    requestedRunMode: "prompt",
    resolvedRunMode: "prompt",
    lastMessageRole: "assistant",
    bootstrapMessageCount: 12,
    agentMessageCount: 12,
  });

  assert.deepEqual(observation.input, {
    source: "new",
    requestedRunMode: "prompt",
    resolvedRunMode: "prompt",
    lastMessageRole: "assistant",
    bootstrapMessageCount: 12,
    agentMessageCount: 12,
  });
  assert.equal(observation.output, undefined);
  assert.deepEqual(observation.metadata, {
    sessionKey: "session-debug",
    sessionId: "session-id-debug",
    provider: "openai-codex",
  });
});

test("debug log observation serializes unsupported values safely", () => {
  const circular: { self?: unknown } = {};
  circular.self = circular;

  const observation = buildDebugObservationContent("runtime.context.request_built", {
    count: 1n,
    handler: function testHandler() {
      return undefined;
    },
    error: new Error("boom"),
    circular,
  });

  assert.equal(observation.input, undefined);
  assert.deepEqual(observation.output && typeof observation.output === "object"
    ? {
      name: (observation.output as { name?: unknown }).name,
      message: (observation.output as { message?: unknown }).message,
      stack: typeof (observation.output as { stack?: unknown }).stack === "string",
    }
    : undefined, {
    name: "Error",
    message: "boom",
    stack: true,
  });
  assert.equal(observation.metadata?.count, "1");
  assert.equal(observation.metadata?.handler, "[Function testHandler]");
  assert.equal(
    observation.metadata?.circular && typeof observation.metadata.circular === "object"
      ? (observation.metadata.circular as { self?: unknown }).self
      : undefined,
    "[Circular]",
  );
});
