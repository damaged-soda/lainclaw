import { parseArgv, type ArgOptionDefinition } from '../shared/argParser.js';

const AGENT_OPTIONS: ArgOptionDefinition[] = [
  { name: 'session', type: 'string' },
  { name: 'provider', type: 'string' },
  { name: 'profile', type: 'string' },
  { name: 'new-session', type: 'boolean', allowEquals: true },
  {
    name: 'with-tools',
    type: 'boolean',
    allowNegated: true,
    allowEquals: true,
  },
  {
    name: 'memory',
    type: 'boolean',
    allowNegated: true,
    allowEquals: true,
  },
  { name: 'tool-allow', type: 'string-list' },
];

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
  const parsed = parseArgv(argv, AGENT_OPTIONS, { strictUnknown: true });
  if (parsed.unknownOptions.length > 0) {
    throw new Error(`Unknown option: ${parsed.unknownOptions[0]}`);
  }

  return {
    input: parsed.positional.join(' '),
    ...(typeof parsed.options.provider === 'string' ? { provider: parsed.options.provider } : {}),
    ...(typeof parsed.options.profile === 'string' ? { profile: parsed.options.profile } : {}),
    ...(typeof parsed.options.session === 'string' ? { sessionKey: parsed.options.session } : {}),
    ...(typeof parsed.options['new-session'] === 'boolean' ? { newSession: parsed.options['new-session'] } : {}),
    ...(typeof parsed.options.memory === 'boolean' ? { memory: parsed.options.memory } : {}),
    ...(typeof parsed.options['with-tools'] === 'boolean' ? { withTools: parsed.options['with-tools'] } : {}),
    ...(Array.isArray(parsed.options['tool-allow']) ? { toolAllow: parsed.options['tool-allow'] as string[] } : {}),
  };
}
