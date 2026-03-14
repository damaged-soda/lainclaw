import assert from "node:assert/strict";
import { test } from "node:test";
import type { Channel, InboundMessage } from "../channels/contracts.js";
import { resolveGatewayChannelBinding } from "../gateway/channelBindings.js";
import { withTempHome } from "./helpers.js";

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

function createFeishuChannel(sent: string[]): Channel {
  return {
    id: "feishu",
    run: async () => {},
    sendText: async (_replyTo, text) => {
      sent.push(text);
    },
  };
}

test("feishu binding intercepts unpaired actors before entering the agent pipeline", async () => {
  await withTempHome(async () => {
    const sent: string[] = [];
    const binding = await resolveGatewayChannelBinding(
      "feishu",
      createFeishuChannel(sent),
      {
        channelConfig: {
          appId: "app-id",
          appSecret: "app-secret",
        },
      },
      {
        channel: "feishu",
      },
    );

    await binding.inboundHandler(createInbound("hello"));

    assert.equal(sent.length, 1);
    assert.match(sent[0] ?? "", /lainclaw pairing approve [A-Z0-9]{8}/);
    assert.doesNotMatch(sent[0] ?? "", /--channel/);
  });
});
