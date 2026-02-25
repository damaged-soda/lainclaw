import { parseModelCommandArgs, throwIfMissingValue } from '../shared/args.js';

export function parseAgentArgs(argv: string[]): {
  input: string;
  provider?: string;
  profile?: string;
  sessionKey?: string;
  newSession?: boolean;
  memory?: boolean;
  withTools?: boolean;
  toolAllow?: string[];
} {
  let sessionKey: string | undefined;
  let newSession = false;
  const modelArgv: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--session') {
      throwIfMissingValue('session', i + 1, argv);
      sessionKey = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--session=')) {
      sessionKey = arg.slice('--session='.length);
      continue;
    }

    if (arg === '--new-session') {
      newSession = true;
      continue;
    }

    modelArgv.push(arg);
  }

  const parsedModel = parseModelCommandArgs(modelArgv, {
    allowMemory: true,
    strictUnknown: true,
  });

  const unknownOption = parsedModel.positional.find((entry) => entry.startsWith('--'));
  if (unknownOption) {
    throw new Error(`Unknown option: ${unknownOption}`);
  }

  return {
    input: parsedModel.positional.join(' '),
    provider: parsedModel.provider,
    profile: parsedModel.profileId,
    sessionKey,
    newSession,
    ...(typeof parsedModel.memory === 'boolean' ? { memory: parsedModel.memory } : {}),
    ...(typeof parsedModel.withTools === 'boolean' ? { withTools: parsedModel.withTools } : {}),
    ...(Array.isArray(parsedModel.toolAllow) ? { toolAllow: parsedModel.toolAllow } : {}),
  };
}
