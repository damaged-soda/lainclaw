import { parseArgv, type ArgOptionDefinition } from './argParser.js';

export function throwIfMissingValue(label: string, index: number, args: string[]): void {
  const next = args[index];
  if (!next || next.startsWith('--')) {
    throw new Error(`Missing value for ${label}`);
  }
}

export function parseMemoryFlag(raw: string): boolean {
  if (raw === '--memory') {
    return true;
  }
  if (raw === '--no-memory') {
    return false;
  }
  if (raw.startsWith('--memory=')) {
    return parseBoolean(raw.slice('--memory='.length), '--memory');
  }
  throw new Error(`Invalid value for --memory: ${raw}`);
}

export function parseBooleanFlag(raw: string, name: 'with-tools' | 'heartbeat-enabled' = 'with-tools'): boolean {
  const normalizedName = name;
  const enabled = `--${normalizedName}`;
  const disabled = `--no-${normalizedName}`;

  if (raw === enabled) {
    return true;
  }
  if (raw === disabled) {
    return false;
  }
  if (raw.startsWith(`${enabled}=`)) {
    return parseBoolean(raw.slice(`${enabled}=`.length), `--${normalizedName}`);
  }
  throw new Error(`Invalid boolean flag: ${raw}`);
}

function parseBoolean(raw: string, name: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'off') {
    return false;
  }
  throw new Error(`Invalid value for ${name} at arg 1: ${raw}`);
}

export function parsePositiveIntValue(raw: string, index: number, label: string): number {
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized) || normalized.length === 0) {
    throw new Error(`Invalid value for ${label} at arg ${index}: ${raw}`);
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid value for ${label} at arg ${index}: ${raw}`);
  }
  return parsed;
}

export function parseCsvOption(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export interface ParsedModelCommandArgs {
  provider?: string;
  profileId?: string;
  withTools?: boolean;
  toolAllow?: string[];
  memory?: boolean;
  positional: string[];
}

export interface ParseModelCommandOptions {
  allowMemory?: boolean;
  strictUnknown?: boolean;
}

const BASE_MODEL_OPTIONS: ArgOptionDefinition[] = [
  { name: 'provider', type: 'string' },
  { name: 'profile', type: 'string' },
  {
    name: 'with-tools',
    type: 'boolean',
    allowNegated: true,
    allowEquals: true,
  },
  { name: 'tool-allow', type: 'string-list' },
];

export function parseModelCommandArgs(
  argv: string[],
  { allowMemory = false, strictUnknown = true }: ParseModelCommandOptions = {},
): ParsedModelCommandArgs {
  const memoryOption: ArgOptionDefinition = allowMemory
    ? {
      name: 'memory',
      type: 'boolean',
      allowNegated: true,
      allowEquals: true,
    }
    : null;

  const specs: ArgOptionDefinition[] = [
    ...BASE_MODEL_OPTIONS,
    ...(memoryOption ? [memoryOption] : []),
  ];

  const parsed = parseArgv(argv, specs, { strictUnknown });
  if (strictUnknown && parsed.unknownOptions.length > 0) {
    throw new Error(`Unknown option: ${parsed.unknownOptions[0]}`);
  }

  return {
    ...(typeof parsed.options.provider === 'string' && parsed.options.provider.trim() !== '' ? { provider: parsed.options.provider } : {}),
    ...(typeof parsed.options.profile === 'string' ? { profileId: parsed.options.profile } : {}),
    ...(typeof parsed.options['with-tools'] === 'boolean' ? { withTools: parsed.options['with-tools'] } : {}),
    ...(Array.isArray(parsed.options['tool-allow']) ? { toolAllow: parsed.options['tool-allow'] as string[] } : {}),
    ...(typeof parsed.options.memory === 'boolean' ? { memory: parsed.options.memory } : {}),
    positional: parsed.positional,
  };
}
