import assert from "node:assert/strict";
import { test } from "node:test";
import { handleInbound, resolveBuiltinInboundCommand } from "../gateway/handlers/handleInbound.js";
import type { InboundMessage } from "../channels/contracts.js";

function createInbound(text: string): InboundMessage {
  return {
    kind: "message",
    channel: "feishu",
    requestId: "req-1",
    actorId: "user-1",
    conversationId: "conv-1",
    replyTo: "reply-1",
    text,
  };
}

test("resolveBuiltinInboundCommand only treats exact /new as a new-session command", () => {
  assert.deepEqual(resolveBuiltinInboundCommand("/new"), {
    kind: "new-session",
    replyText: "已为你开启新会话。接下来我会按新的上下文继续。",
  });
  assert.deepEqual(resolveBuiltinInboundCommand("  /new  "), {
    kind: "new-session",
    replyText: "已为你开启新会话。接下来我会按新的上下文继续。",
  });
  assert.equal(resolveBuiltinInboundCommand("/new hi"), undefined);
  assert.equal(resolveBuiltinInboundCommand("/newx"), undefined);
});

test("handleInbound maps /new to a fresh session instead of sending it to the model", async () => {
  const calls: Array<{
    input: string;
    channelId?: string;
    sessionKey?: string;
    runtime?: Record<string, unknown>;
  }> = [];

  const outbound = await handleInbound(createInbound("/new"), {
    runtime: {
      provider: "stub",
      profileId: "default",
      withTools: true,
      memory: true,
      debug: true,
    },
    runAgentFn: async (request) => {
      calls.push(request as typeof calls[number]);
      return {
        requestId: "req-1",
        sessionKey: "user-1:conv-1",
        sessionId: "session-2",
        text: "",
        isNewSession: true,
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, "/new");
  assert.equal(calls[0]?.sessionKey, "user-1:conv-1");
  assert.equal(calls[0]?.runtime?.newSession, true);
  assert.equal(calls[0]?.runtime?.userId, "user-1");
  assert.ok(outbound);
  assert.equal(outbound.text, "已为你开启新会话。接下来我会按新的上下文继续。");
});

test("handleInbound keeps local-style final text responses unchanged", async () => {
  const outbound = await handleInbound(createInbound("hello"), {
    runtime: {
      provider: "stub",
      profileId: "default",
      withTools: true,
      memory: false,
    },
    runAgentFn: async (request) => {
      assert.equal(request.runtime?.userId, "user-1");
      return {
        requestId: "req-1",
        sessionKey: "user-1:conv-1",
        sessionId: "session-1",
        text: "final reply",
      };
    },
  });

  assert.ok(outbound);
  assert.equal(outbound.text, "final reply");
});

test("handleInbound still short-circuits denied access without running the agent", async () => {
  let runAgentCalled = false;

  const outbound = await handleInbound(createInbound("hello"), {
    runtime: {
      provider: "stub",
      profileId: "default",
      withTools: true,
    },
    policyConfig: {
      pairingPolicy: "disabled",
    },
    runAgentFn: async () => {
      runAgentCalled = true;
      return {
        requestId: "req-1",
        sessionKey: "user-1:conv-1",
        sessionId: "session-1",
        text: "should not happen",
      };
    },
  });

  assert.equal(runAgentCalled, false);
  assert.ok(outbound);
  assert.equal(outbound.text, "当前策略不允许当前用户发起会话，请联系管理员配置后重试。");
});
