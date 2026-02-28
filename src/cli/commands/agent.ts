import { parseAgentArgs } from '../parsers/agent.js';
import { ValidationError } from '../../shared/types.js';
import { runAgent } from '../../gateway/index.js';
import { runCommand } from '../shared/result.js';

export async function runAgentCommand(args: string[]): Promise<number> {
  return runCommand(async () => {
    const {
      input,
      provider,
      profile,
      sessionKey,
      newSession,
      memory,
      withTools,
      toolAllow,
    } = parseAgentArgs(args);
    if (!input.trim()) {
      throw new ValidationError("agent command requires non-empty input", "AGENT_INPUT_REQUIRED");
    }

    const response = await runAgent({
      input,
      channelId: "cli",
      sessionKey,
      runtime: {
        provider,
        profileId: profile,
        newSession,
        memory,
        withTools,
        toolAllow,
      },
    });

    if (response.text.length === 0 && response.isNewSession === true) {
      console.log(`New session started. sessionId=${response.sessionId}`);
      return 0;
    }

    console.log(response.text);
    return 0;
  }, {
    renderError: (error) => {
      if (error instanceof ValidationError) {
        console.error(`[${error.code}] ${error.message}`);
        console.error("Usage: lainclaw agent <input>");
        return;
      }
      console.error("ERROR:", String(error instanceof Error ? error.message : error));
    },
  });
}
