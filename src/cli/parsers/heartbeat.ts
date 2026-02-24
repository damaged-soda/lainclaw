import {
  parseBooleanFlag,
  parseCsvOption,
  parseMemoryFlag,
  parsePositiveIntValue,
  throwIfMissingValue,
} from '../shared/args.js';

interface HeartbeatCommandOptions {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
  memory?: boolean;
  positional: string[];
}

export function parseHeartbeatModelArgs(argv: string[], allowMemory = false): HeartbeatCommandOptions {
  let provider: string | undefined;
  let profileId: string | undefined;
  let withTools: boolean | undefined;
  let toolAllow: string[] | undefined;
  let toolMaxSteps: number | undefined;
  let memory: boolean | undefined;
  const positional: string[] = [];

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
      profileId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--profile=')) {
      profileId = arg.slice('--profile='.length);
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

    if (allowMemory && (arg === '--memory' || arg === '--no-memory' || arg.startsWith('--memory='))) {
      memory = parseMemoryFlag(arg, i);
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positional.push(arg);
  }

  return {
    provider,
    profileId,
    withTools,
    ...(toolAllow ? { toolAllow } : {}),
    ...(typeof toolMaxSteps === 'number' ? { toolMaxSteps } : {}),
    ...(typeof memory === 'boolean' ? { memory } : {}),
    positional,
  };
}

export function parseHeartbeatAddArgs(argv: string[]): {
  ruleText: string;
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
} {
  const parsed = parseHeartbeatModelArgs(argv, false);
  const ruleText = parsed.positional.join(' ').trim();
  if (!ruleText) {
    throw new Error('Missing rule text.');
  }
  return {
    ruleText,
    ...(parsed.provider ? { provider: parsed.provider } : {}),
    ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
    ...(typeof parsed.withTools === 'boolean' ? { withTools: parsed.withTools } : {}),
    ...(parsed.toolAllow ? { toolAllow: parsed.toolAllow } : {}),
    ...(typeof parsed.toolMaxSteps === 'number' ? { toolMaxSteps: parsed.toolMaxSteps } : {}),
  };
}

export function parseHeartbeatRunArgs(argv: string[]): {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
  memory?: boolean;
} {
  const parsed = parseHeartbeatModelArgs(argv, true);
  if (parsed.positional.length > 0) {
    throw new Error(`Unknown argument for heartbeat run: ${parsed.positional[0]}`);
  }
  return {
    ...(parsed.provider ? { provider: parsed.provider } : {}),
    ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
    ...(typeof parsed.withTools === 'boolean' ? { withTools: parsed.withTools } : {}),
    ...(parsed.toolAllow ? { toolAllow: parsed.toolAllow } : {}),
    ...(typeof parsed.toolMaxSteps === 'number' ? { toolMaxSteps: parsed.toolMaxSteps } : {}),
    ...(typeof parsed.memory === 'boolean' ? { memory: parsed.memory } : {}),
  };
}

export function parseHeartbeatInitArgs(argv: string[]): { force: boolean; templatePath?: string } {
  let force = false;
  let templatePath: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '--template') {
      if (i + 1 >= argv.length) {
        throw new Error('Missing value for --template');
      }
      templatePath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--template=')) {
      templatePath = arg.slice('--template='.length);
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { force, ...(templatePath ? { templatePath } : {}) };
}
