import { parseArgv, type ArgOptionDefinition } from '../shared/argParser.js';
import { parseModelCommandArgs, type ParsedModelCommandArgs } from '../shared/args.js';

const HEARTBEAT_INIT_OPTIONS: ArgOptionDefinition[] = [
  { name: 'force', type: 'boolean', allowEquals: true },
  { name: 'template', type: 'string' },
];

function parseHeartbeatInitOptions(argv: string[]): { force: boolean; templatePath?: string } {
  const parsed = parseArgv(argv, HEARTBEAT_INIT_OPTIONS, { strictUnknown: true });
  if (parsed.unknownOptions.length > 0) {
    throw new Error(`Unknown option: ${parsed.unknownOptions[0]}`);
  }
  if (parsed.positional.length > 0) {
    throw new Error(`Unknown argument: ${parsed.positional[0]}`);
  }
  return {
    force: parsed.options.force === true,
    ...(typeof parsed.options.template === 'string' ? { templatePath: parsed.options.template } : {}),
  };
}

export function parseHeartbeatAddArgs(argv: string[]): {
  ruleText: string;
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  toolAllow?: string[];
} {
  const parsed: ParsedModelCommandArgs = parseModelCommandArgs(argv, {
    allowMemory: false,
    strictUnknown: true,
  });

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
  };
}

export function parseHeartbeatRunArgs(argv: string[]): {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  toolAllow?: string[];
  memory?: boolean;
} {
  const parsed = parseModelCommandArgs(argv, {
    allowMemory: true,
    strictUnknown: true,
  });
  if (parsed.positional.length > 0) {
    throw new Error(`Unknown argument for heartbeat run: ${parsed.positional[0]}`);
  }
  return {
    ...(parsed.provider ? { provider: parsed.provider } : {}),
    ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
    ...(typeof parsed.withTools === 'boolean' ? { withTools: parsed.withTools } : {}),
    ...(parsed.toolAllow ? { toolAllow: parsed.toolAllow } : {}),
    ...(typeof parsed.memory === 'boolean' ? { memory: parsed.memory } : {}),
  };
}

export function parseHeartbeatInitArgs(argv: string[]): { force: boolean; templatePath?: string } {
  return parseHeartbeatInitOptions(argv);
}
