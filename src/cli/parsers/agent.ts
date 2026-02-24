import {
  parseBooleanFlag,
  parseCsvOption,
  parseMemoryFlag,
  parsePositiveIntValue,
  throwIfMissingValue,
} from '../shared/args.js';

export function parseAgentArgs(argv: string[]): {
  input: string;
  provider?: string;
  profile?: string;
  sessionKey?: string;
  newSession?: boolean;
  memory?: boolean;
  withTools?: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
} {
  let provider: string | undefined;
  let profile: string | undefined;
  let sessionKey: string | undefined;
  let newSession = false;
  let memory: boolean | undefined;
  let withTools: boolean | undefined;
  let toolAllow: string[] | undefined;
  let toolMaxSteps: number | undefined;
  const inputParts: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--provider') {
      throwIfMissingValue('provider', i + 1, argv);
      provider = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--provider=')) {
      provider = arg.slice('--provider='.length);
      continue;
    }

    if (arg === '--profile') {
      throwIfMissingValue('profile', i + 1, argv);
      profile = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length);
      continue;
    }

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

    if (arg === '--memory' || arg === '--no-memory' || arg.startsWith('--memory=')) {
      memory = parseMemoryFlag(arg, i);
      continue;
    }

    if (arg === '--with-tools' || arg === '--no-with-tools' || arg.startsWith('--with-tools=')) {
      withTools = parseBooleanFlag(arg, i);
      continue;
    }

    if (arg === '--tool-allow') {
      throwIfMissingValue('tool-allow', i + 1, argv);
      toolAllow = parseCsvOption(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg.startsWith('--tool-allow=')) {
      toolAllow = parseCsvOption(arg.slice('--tool-allow='.length));
      continue;
    }

    if (arg === '--tool-max-steps') {
      throwIfMissingValue('tool-max-steps', i + 1, argv);
      toolMaxSteps = parsePositiveIntValue(argv[i + 1], i + 1, '--tool-max-steps');
      i += 1;
      continue;
    }

    if (arg.startsWith('--tool-max-steps=')) {
      toolMaxSteps = parsePositiveIntValue(arg.slice('--tool-max-steps='.length), i + 1, '--tool-max-steps');
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    inputParts.push(arg);
  }

  return {
    input: inputParts.join(' '),
    provider,
    profile,
    sessionKey,
    newSession,
    memory,
    withTools,
    toolAllow,
    toolMaxSteps,
  };
}
