import { parseAgentArgs } from '../parsers/agent.js';
import { ValidationError } from '../../shared/types.js';
import { runAgent } from '../../gateway/gateway.js';
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
    if (provider && provider !== "openai-codex") {
      throw new ValidationError(`Unsupported provider: ${provider}`, "UNSUPPORTED_PROVIDER");
    }
    if (!input) {
      throw new ValidationError("agent command requires non-empty input", "AGENT_INPUT_REQUIRED");
    }
    const response = await runAgent(input, {
      ...(provider ? { provider } : {}),
      ...(profile ? { profileId: profile } : {}),
      ...(sessionKey ? { sessionKey } : {}),
      ...(newSession ? { newSession } : {}),
      ...(typeof memory === "boolean" ? { memory } : {}),
      ...(typeof withTools === "boolean" ? { withTools } : {}),
      ...(toolAllow ? { toolAllow } : {}),
      channel: "agent",
    });

    if (response.success) {
      console.log(JSON.stringify(response, null, 2));
      return 0;
    }
    return 1;
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
