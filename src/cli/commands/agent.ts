import { ValidationError } from '../../shared/types.js';
import { runAgent } from '../../gateway/index.js';
import { runCommand } from '../shared/result.js';

export interface AgentCommandInput {
  input: string;
  provider?: string;
  profile?: string;
  session?: string;
  newSession?: boolean;
  memory?: boolean;
  withTools?: boolean;
  toolAllow?: string[];
}

export async function runAgentCommand(input: AgentCommandInput): Promise<number> {
  return runCommand(async () => {
    if (!input.input.trim()) {
      throw new ValidationError("agent command requires non-empty input", "AGENT_INPUT_REQUIRED");
    }

    const response = await runAgent({
      input: input.input,
      channelId: "cli",
      sessionKey: input.session,
      runtime: {
        provider: input.provider,
        profileId: input.profile,
        newSession: input.newSession,
        memory: input.memory,
        withTools: input.withTools,
        toolAllow: input.toolAllow,
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
