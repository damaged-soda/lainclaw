import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@mariozechner/pi-ai";
import { createCoreCoordinator } from "../core/index.js";
import type { CoreTraceEvent } from "../core/contracts.js";
import { createRuntimeAdapter } from "../runtime/adapter.js";
import { createSessionAdapter } from "../sessions/adapter.js";
import { createToolsAdapter } from "../tools/adapter.js";
import type { RuntimeAgentEvent } from "../shared/types.js";
import { withTempHome } from "./helpers.js";

function makeAssistantMessage(text: string): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "stub-responses",
    provider: "stub",
    model: "stub-model",
    usage: {
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
    },
    stopReason: "stop",
    timestamp: Date.now(),
  } as Message;
}

test("core and runtime adapter can observe raw AgentEvent envelopes", async () => {
  await withTempHome(async () => {
    const emitted: CoreTraceEvent[] = [];
    const forwarded: RuntimeAgentEvent[] = [];
    const assistantMessage = makeAssistantMessage("runtime reply");
    const coordinator = createCoreCoordinator({
      sessionAdapter: createSessionAdapter(),
      toolsAdapter: createToolsAdapter(),
      runtimeAdapter: createRuntimeAdapter({
        run: async (input) => {
          await input.onAgentEvent?.({
            requestId: input.requestContext.requestId,
            sessionKey: input.requestContext.sessionKey,
            sessionId: input.requestContext.sessionId,
            route: "adapter.stub",
            provider: input.requestContext.provider,
            profileId: input.requestContext.profileId,
            event: {
              type: "message_start",
              message: assistantMessage,
            },
          });
          await input.onAgentEvent?.({
            requestId: input.requestContext.requestId,
            sessionKey: input.requestContext.sessionKey,
            sessionId: input.requestContext.sessionId,
            route: "adapter.stub",
            provider: input.requestContext.provider,
            profileId: input.requestContext.profileId,
            event: {
              type: "agent_end",
              messages: [assistantMessage],
            },
          });

          return {
            route: "adapter.stub",
            stage: "adapter.stub.event-test",
            result: "runtime reply",
            runMode: "prompt",
            assistantMessage,
            stopReason: "stop",
            provider: input.requestContext.provider,
            profileId: input.requestContext.profileId,
          };
        },
      }),
      emitEvent: async (event) => {
        emitted.push(event);
      },
    });

    const result = await coordinator.runAgent("ping", {
      provider: "stub",
      profileId: "default",
      sessionKey: "core-runtime-event-session",
      withTools: false,
      memory: false,
      onAgentEvent: async (event) => {
        forwarded.push(event);
      },
    });

    const runtimeEvents = emitted
      .filter((event) => event.name === "agent.runtime.event")
      .map((event) => (event.payload as { agentEvent: { event: { type: string } } }).agentEvent.event.type);

    assert.equal(result.text, "runtime reply");
    assert.deepEqual(runtimeEvents, ["message_start", "agent_end"]);
    assert.deepEqual(forwarded.map((event) => event.event.type), ["message_start", "agent_end"]);
  });
});
