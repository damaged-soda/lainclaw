import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@mariozechner/pi-ai";
import { createRuntimeAdapter } from "../runtime/adapter.js";

function makeUserMessage(content: string): Message {
  return {
    role: "user",
    content,
    timestamp: Date.now(),
  } as Message;
}

test("runtime adapter only dispatches prepared execution input to the resolved provider", async () => {
  let captured:
    | {
      requestContext: {
        provider: string;
        runMode: string;
      };
      preparedState: {
        source: string;
        initialMessages: Message[];
        initialSystemPrompt: string;
      };
      withTools: boolean;
      cwd?: string;
      toolSpecs?: Array<{ name: string }>;
    }
    | undefined;

  const adapter = createRuntimeAdapter({
    resolveProviderFn: (provider) => ({
      provider,
      run: async (input) => {
        captured = {
          requestContext: {
            provider: input.requestContext.provider,
            runMode: input.requestContext.runMode,
          },
          preparedState: {
            source: input.preparedState.source,
            initialMessages: input.preparedState.initialMessages,
            initialSystemPrompt: input.preparedState.initialSystemPrompt ?? "",
          },
          withTools: input.withTools,
          cwd: input.cwd,
          toolSpecs: input.toolSpecs?.map((tool) => ({ name: tool.name })),
        };
        return {
          route: `adapter.${input.requestContext.provider}`,
          stage: "adapter.test",
          result: "provider-result",
          runMode: input.requestContext.runMode,
          continueReason: input.requestContext.continueReason,
          provider: input.requestContext.provider,
          profileId: input.requestContext.profileId,
        };
      },
    }),
  });

  const result = await adapter.run({
    requestContext: {
      requestId: "req-runtime-adapter",
      createdAt: "2026-03-11T00:00:00.000Z",
      input: "",
      sessionKey: "runtime-adapter-session",
      sessionId: "runtime-adapter-session-id",
      provider: "stub",
      profileId: "default",
      runMode: "continue",
      continueReason: "tool_result",
    },
    preparedState: {
      source: "snapshot",
      initialMessages: [makeUserMessage("resume from prepared state")],
      initialSystemPrompt: "system",
    },
    withTools: true,
    toolSpecs: [
      {
        name: "write",
        description: "write file",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
    cwd: "workspace",
  });

  assert.ok(captured);
  assert.equal(captured.requestContext.provider, "stub");
  assert.equal(captured.requestContext.runMode, "continue");
  assert.equal(captured.preparedState.source, "snapshot");
  assert.equal(captured.preparedState.initialSystemPrompt, "system");
  assert.equal(captured.preparedState.initialMessages[0]?.role, "user");
  assert.equal(captured.withTools, true);
  assert.equal(captured.cwd, path.resolve("workspace"));
  assert.deepEqual(captured.toolSpecs, [{ name: "write" }]);
  assert.equal(result.route, "adapter.stub");
  assert.equal(result.result, "provider-result");
  assert.equal(result.runMode, "continue");
  assert.equal(result.continueReason, "tool_result");
});
