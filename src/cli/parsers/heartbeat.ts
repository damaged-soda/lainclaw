import { parseModelCommandArgs, type ParsedModelCommandArgs } from '../shared/args.js';

interface HeartbeatCommandOptions {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  toolAllow?: string[];
  toolMaxSteps?: number;
  memory?: boolean;
  positional: string[];
}

function parseHeartbeatModelArgs(argv: string[], allowMemory = false): ParsedModelCommandArgs {
  return parseModelCommandArgs(argv, { allowMemory, strictUnknown: true });
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
  const unknownOption = parsed.positional.find((entry) => entry.startsWith('--'));
  if (unknownOption) {
    throw new Error(`Unknown option: ${unknownOption}`);
  }
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
