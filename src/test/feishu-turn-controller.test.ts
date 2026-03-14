import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { runFeishuInbound } from '../channels/feishu/inbound.js';
import type { InboundMessage } from '../channels/contracts.js';
import type { RuntimeAgentEvent } from '../shared/types.js';

const SLOW_ACK_TEXT = '已收到，正在处理。完成后我会继续把结果发给你。';

function createInbound(text: string): InboundMessage {
  return {
    kind: 'message',
    channel: 'feishu',
    requestId: 'req-1',
    actorId: 'ou_user-1',
    conversationId: 'dm:ou_user-1',
    replyTo: 'ou_user-1',
    text,
  };
}

function createAgentEvent(type: RuntimeAgentEvent['event']['type']): RuntimeAgentEvent {
  return {
    requestId: 'req-1',
    sessionKey: 'ou_user-1:dm:ou_user-1',
    sessionId: 'session-1',
    route: 'adapter.stub',
    provider: 'stub',
    profileId: 'default',
    event: {
      type,
    } as RuntimeAgentEvent['event'],
  };
}

test('runFeishuInbound fast path only sends the final message', async () => {
  const sent: string[] = [];

  await runFeishuInbound({
    inbound: createInbound('hello'),
    runtime: {
      provider: 'stub',
      profileId: 'default',
      withTools: false,
    },
    outbound: {
      sendText: async (_replyTo, text) => {
        sent.push(text);
      },
    },
    slowAckDelayMs: 20,
    runAgentFn: async () => {
      await delay(5);
      return {
        requestId: 'req-1',
        sessionKey: 'ou_user-1:dm:ou_user-1',
        sessionId: 'session-1',
        text: 'final reply',
      };
    },
  });

  await delay(30);
  assert.deepEqual(sent, ['final reply']);
});

test('runFeishuInbound slow path sends one ack before the final reply', async () => {
  const sent: string[] = [];

  await runFeishuInbound({
    inbound: createInbound('hello'),
    runtime: {
      provider: 'stub',
      profileId: 'default',
      withTools: false,
    },
    outbound: {
      sendText: async (_replyTo, text) => {
        sent.push(text);
      },
    },
    slowAckDelayMs: 20,
    runAgentFn: async (request) => {
      await delay(5);
      await request.onAgentEvent?.(createAgentEvent('agent_start'));
      await delay(25);
      return {
        requestId: 'req-1',
        sessionKey: 'ou_user-1:dm:ou_user-1',
        sessionId: 'session-1',
        text: 'final reply',
      };
    },
  });

  assert.deepEqual(sent, [SLOW_ACK_TEXT, 'final reply']);
});

test('runFeishuInbound error after slow ack sends ack then failure', async () => {
  const sent: string[] = [];

  await runFeishuInbound({
    inbound: createInbound('hello'),
    runtime: {
      provider: 'stub',
      profileId: 'default',
      withTools: false,
    },
    outbound: {
      sendText: async (_replyTo, text) => {
        sent.push(text);
      },
    },
    slowAckDelayMs: 20,
    runAgentFn: async (request) => {
      await delay(5);
      await request.onAgentEvent?.(createAgentEvent('agent_start'));
      await delay(25);
      throw new Error('boom');
    },
  });

  assert.equal(sent[0], SLOW_ACK_TEXT);
  assert.equal(sent[1], '[Lainclaw] boom（requestId: req-1）');
});

test('runFeishuInbound access deny replies directly without starting the agent turn', async () => {
  const sent: string[] = [];
  let runAgentCalled = false;

  await runFeishuInbound({
    inbound: createInbound('hello'),
    runtime: {
      provider: 'stub',
      profileId: 'default',
      withTools: false,
    },
    outbound: {
      sendText: async (_replyTo, text) => {
        sent.push(text);
      },
    },
    slowAckDelayMs: 10,
    policyConfig: {
      pairingPolicy: 'disabled',
    },
    runAgentFn: async () => {
      runAgentCalled = true;
      return {
        requestId: 'req-1',
        sessionKey: 'ou_user-1:dm:ou_user-1',
        sessionId: 'session-1',
        text: 'final reply',
      };
    },
  });

  await delay(20);
  assert.equal(runAgentCalled, false);
  assert.deepEqual(sent, ['当前策略不允许当前用户发起会话，请联系管理员配置后重试。']);
});
