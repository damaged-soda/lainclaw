import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAgent } from '../agent/invoke.js';
import { agentCoordinator } from '../agent/coordinator.js';
import type { RuntimeAgentEvent } from '../shared/types.js';

test('runAgent forwards onAgentEvent to the core coordinator request', async () => {
  const originalRunAgent = agentCoordinator.runAgent;
  const observed: RuntimeAgentEvent[] = [];

  agentCoordinator.runAgent = async (_input, options) => {
    await options.onAgentEvent?.({
      requestId: 'req-1',
      sessionKey: options.sessionKey,
      sessionId: 'session-1',
      route: 'adapter.stub',
      provider: options.provider,
      profileId: options.profileId,
      event: {
        type: 'agent_start',
      } as RuntimeAgentEvent['event'],
    });

    return {
      requestId: 'req-1',
      sessionKey: options.sessionKey,
      sessionId: 'session-1',
      text: 'forwarded',
    };
  };

  try {
    const result = await runAgent({
      input: 'ping',
      channelId: 'feishu',
      sessionKey: 'session-key',
      runtime: {
        provider: 'stub',
        profileId: 'default',
        withTools: false,
      },
      onAgentEvent: async (event) => {
        observed.push(event);
      },
    });

    assert.equal(result.text, 'forwarded');
    assert.deepEqual(observed.map((event) => event.event.type), ['agent_start']);
    assert.equal(observed[0]?.sessionKey, 'session-key');
  } finally {
    agentCoordinator.runAgent = originalRunAgent;
  }
});
