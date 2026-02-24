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
