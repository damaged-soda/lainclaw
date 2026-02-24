export function throwIfMissingValue(label: string, index: number, args: string[]): void {
  const next = args[index];
  if (!next || next.startsWith("--")) {
    throw new Error(`Missing value for ${label}`);
  }
}

export function parseMemoryFlag(raw: string, index: number): boolean {
  if (raw === '--memory') {
    return true;
  }
  if (raw === '--no-memory') {
    return false;
  }
  if (raw.startsWith('--memory=')) {
    const value = raw.slice('--memory='.length).toLowerCase();
    if (value === 'on' || value === 'true' || value === '1') {
      return true;
    }
    if (value === 'off' || value === 'false' || value === '0') {
      return false;
    }
    throw new Error(`Invalid value for --memory at arg ${index + 1}: ${value}`);
  }
  return false;
}

export function parseBooleanFlag(raw: string, index: number, name: 'with-tools' | 'heartbeat-enabled' = 'with-tools'): boolean {
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
    const value = raw.slice(`${enabled}=`.length).toLowerCase();
    if (value === 'on' || value === 'true' || value === '1') {
      return true;
    }
    if (value === 'off' || value === 'false' || value === '0') {
      return false;
    }
    throw new Error(`Invalid value for ${enabled} at arg ${index + 1}: ${value}`);
  }
  throw new Error(`Invalid boolean flag: ${raw}`);
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
  toolMaxSteps?: number;
  memory?: boolean;
  positional: string[];
}

export interface ParseModelCommandOptions {
  allowMemory?: boolean;
  strictUnknown?: boolean;
}

export function parseModelCommandArgs(
  argv: string[],
  { allowMemory = false, strictUnknown = true }: ParseModelCommandOptions = {},
): ParsedModelCommandArgs {
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

    if ((arg === '--memory' || arg === '--no-memory' || arg.startsWith('--memory='))) {
      if (allowMemory) {
        memory = parseMemoryFlag(arg, i);
      } else if (strictUnknown) {
        throw new Error(`Unknown option: ${arg}`);
      } else {
        positional.push(arg);
      }
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
      if (strictUnknown) {
        throw new Error(`Unknown option: ${arg}`);
      }
      positional.push(arg);
      continue;
    }

    positional.push(arg);
  }

  return {
    ...(provider ? { provider } : {}),
    ...(profileId ? { profileId } : {}),
    ...(typeof withTools === 'boolean' ? { withTools } : {}),
    ...(Array.isArray(toolAllow) ? { toolAllow } : {}),
    ...(typeof toolMaxSteps === 'number' && Number.isFinite(toolMaxSteps) && toolMaxSteps > 0 ? { toolMaxSteps } : {}),
    ...(typeof memory === 'boolean' ? { memory } : {}),
    positional,
  };
}
