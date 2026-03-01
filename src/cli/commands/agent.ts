import { Command, Option } from 'commander';
import { runCommand } from '../shared/result.js';
import { ValidationError } from '../../shared/types.js';
import { runAgent } from '../../gateway/index.js';
import { setExitCode } from '../shared/exitCode.js';
import { addModelOptions } from '../shared/options.js';

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
      throw new ValidationError('agent command requires non-empty input', 'AGENT_INPUT_REQUIRED');
    }

    const response = await runAgent({
      input: input.input,
      channelId: 'cli',
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
        console.error('Usage: lainclaw agent <input>');
        return;
      }
      console.error('ERROR:', String(error instanceof Error ? error.message : error));
    },
  });
}

interface AgentOptions {
  provider?: string;
  profile?: string;
  session?: string;
  newSession?: boolean;
  memory?: boolean;
  withTools?: boolean;
  toolAllow?: string[];
}

function normalizeInput(input: string[]): string {
  return input.join(' ').trim();
}

export function buildAgentCommand(program: Command): Command {
  const command = program
    .command('agent')
    .description('Run agent command')
    .argument('[input...]')
    .addHelpText('after', [
      'Examples:',
      '  lainclaw agent 这是一段测试文本',
      '  lainclaw agent --session work --provider <provider> --profile default 这是一段测试输入',
      '  lainclaw agent --session work --memory 这是一个长期记忆测试',
      '  lainclaw agent --session work --memory=off 这是一条不写入记忆的消息',
    ].join('\n'))
    .action(async (input: string[], options: AgentOptions, command: Command) => {
      const parsed = {
        ...options,
        profile: options.profile,
        input: normalizeInput(input),
      };
      const code = await runAgentCommand({
        input: parsed.input,
        ...(parsed.provider ? { provider: parsed.provider } : {}),
        ...(parsed.profile ? { profile: parsed.profile } : {}),
        ...(parsed.session ? { session: parsed.session } : {}),
        ...(parsed.newSession === true ? { newSession: true } : {}),
        ...(typeof parsed.memory === 'boolean' ? { memory: parsed.memory } : {}),
        ...(typeof parsed.withTools === 'boolean' ? { withTools: parsed.withTools } : {}),
        ...(Array.isArray(parsed.toolAllow) ? { toolAllow: parsed.toolAllow } : {}),
      });
      setExitCode(command, code);
    });

  addModelOptions(command, {
    providerDescription: 'Select model provider by name.',
    profileDescription: 'Select provider profile.',
    withToolsDescription: 'Enable/disable tool calls.',
    noWithToolsDescription: 'Disable tool calls.',
    toolAllowDescription: 'Limit allowed tool names (comma-separated).',
    includeMemory: true,
    memoryDescription: 'Enable/disable memory persistence for this call.',
    noMemoryDescription: 'Disable memory persistence for this call.',
  });
  command
    .addOption(new Option('--session <name>', 'Use specified session id.'))
    .addOption(new Option('--new-session', 'Start a fresh session.'));

  return command;
}
