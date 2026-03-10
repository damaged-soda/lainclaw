import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@mariozechner/pi-ai";
import { buildRuntimeRequestContext } from "../runtime/context.js";
import { buildCodexDebugRequestSnapshot } from "../providers/codexDebug.js";

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

test("runtime context emits stdout debug logs when debug is enabled", async () => {
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
  assert.match(output, /runtime\.context\.bootstrap_attached/);
  assert.match(output, /runtime\.context\.memory_loaded/);
  assert.match(output, /runtime\.context\.user_input_attached/);
  assert.match(output, /runtime\.context\.request_built/);
  assert.match(output, /latest input/);
  assert.match(output, /remember this/);
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
