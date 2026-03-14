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
    outbound: {
      sendText: async (_replyTo, text) => {
        sent.push(text);
      },
    },
    slowAckDelayMs: 20,
    handleTurn: async () => {
      await delay(5);
      return { text: 'final reply' };
    },
  });

  await delay(30);
  assert.deepEqual(sent, ['final reply']);
});

test('runFeishuInbound slow path sends one ack before the final reply', async () => {
  const sent: string[] = [];

  await runFeishuInbound({
    inbound: createInbound('hello'),
    outbound: {
      sendText: async (_replyTo, text) => {
        sent.push(text);
      },
    },
    slowAckDelayMs: 20,
    handleTurn: async (request) => {
      await delay(5);
      await request.onAgentEvent?.(createAgentEvent('agent_start'));
      await delay(25);
      return { text: 'final reply' };
    },
  });

  assert.deepEqual(sent, [SLOW_ACK_TEXT, 'final reply']);
});

test('runFeishuInbound error after slow ack sends ack then failure', async () => {
  const sent: string[] = [];

  await runFeishuInbound({
    inbound: createInbound('hello'),
    outbound: {
      sendText: async (_replyTo, text) => {
        sent.push(text);
      },
    },
    slowAckDelayMs: 20,
    handleTurn: async (request) => {
      await delay(5);
      await request.onAgentEvent?.(createAgentEvent('agent_start'));
      await delay(25);
      throw new Error('boom');
    },
  });

  assert.equal(sent[0], SLOW_ACK_TEXT);
  assert.equal(sent[1], '[Lainclaw] boom（requestId: req-1）');
});

test('runFeishuInbound final reply send failure still rejects after delivering fallback failure text', async () => {
  const sent: string[] = [];

  await assert.rejects(
    runFeishuInbound({
      inbound: createInbound('hello'),
      outbound: {
        sendText: async (_replyTo, text) => {
          if (text === 'final reply') {
            throw new Error('feishu send failed');
          }
          sent.push(text);
        },
      },
      slowAckDelayMs: 20,
      handleTurn: async () => {
        return { text: 'final reply' };
      },
    }),
    /failed to send Feishu final reply: feishu send failed/,
  );

  assert.deepEqual(sent, ['[Lainclaw] feishu send failed（requestId: req-1）']);
});

test('runFeishuInbound can reply directly without starting a streamed agent turn', async () => {
  const sent: string[] = [];
  let handleTurnCalled = false;

  await runFeishuInbound({
    inbound: createInbound('hello'),
    outbound: {
      sendText: async (_replyTo, text) => {
        sent.push(text);
      },
    },
    slowAckDelayMs: 10,
    handleTurn: async () => {
      handleTurnCalled = true;
      return {
        text: '当前策略不允许当前用户发起会话，请联系管理员配置后重试。',
      };
    },
  });

  await delay(20);
  assert.equal(handleTurnCalled, true);
  assert.deepEqual(sent, ['当前策略不允许当前用户发起会话，请联系管理员配置后重试。']);
});
