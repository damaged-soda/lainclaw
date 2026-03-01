export type ArgOptionType = 'boolean' | 'integer' | 'string' | 'string-list';

export interface ArgOptionDefinition {
  name: string;
  type: ArgOptionType;
  aliases?: string[];
  allowEquals?: boolean;
  allowNegated?: boolean;
  defaultValue?: unknown;
  multiple?: boolean;
  parse?: (raw: string, index: number, name: string) => unknown;
}

export interface ParseArgvOptions {
  strictUnknown?: boolean;
}

export interface ParsedArgv {
  options: Record<string, unknown>;
  positional: string[];
  unknownOptions: string[];
}

function parseBoolean(raw: string, index: number, name: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'off') {
    return false;
  }
  throw new Error(`Invalid value for --${name} at arg ${index + 1}: ${raw}`);
}

function parseInteger(raw: string, index: number, name: string): number {
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized) || normalized.length === 0) {
    throw new Error(`Invalid value for --${name} at arg ${index + 1}: ${raw}`);
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid value for --${name} at arg ${index + 1}: ${raw}`);
  }
  return parsed;
}

function parseStringList(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeKey(raw: string): string {
  return raw.toLowerCase();
}

function optionKey(raw: string): string {
  return `--${normalizeKey(raw)}`;
}

function buildSpecLookup(definitions: ArgOptionDefinition[]): Map<string, ArgOptionDefinition> {
  const specByName = new Map<string, ArgOptionDefinition>();
  for (const spec of definitions) {
    specByName.set(optionKey(spec.name), spec);
    for (const alias of spec.aliases ?? []) {
      specByName.set(optionKey(alias), spec);
    }
  }
  return specByName;
}

function appendOption(
  options: Record<string, unknown>,
  spec: ArgOptionDefinition,
  value: unknown,
): void {
  if (!spec.multiple) {
    options[spec.name] = value;
    return;
  }

  const existing = options[spec.name];
  if (Array.isArray(existing)) {
    existing.push(value);
    return;
  }

  options[spec.name] = [value];
}

function applyDefaults(
  parsed: Record<string, unknown>,
  definitions: ArgOptionDefinition[],
): void {
  for (const spec of definitions) {
    if (spec.defaultValue !== undefined && !Object.prototype.hasOwnProperty.call(parsed, spec.name)) {
      parsed[spec.name] = spec.defaultValue;
    }
  }
}

function resolveValue(
  spec: ArgOptionDefinition,
  index: number,
  hasEquals: boolean,
  rawValue: string | undefined,
  nextValue: string | undefined,
): unknown {
  if (hasEquals) {
    if (spec.parse) {
      return spec.parse(rawValue ?? '', index, spec.name);
    }
    if (spec.type === 'integer') {
      return parseInteger(rawValue ?? '', index, spec.name);
    }
    if (spec.type === 'string-list') {
      return parseStringList(rawValue ?? '');
    }
    return rawValue ?? '';
  }

  if (typeof nextValue !== 'string' || nextValue.startsWith('--')) {
    throw new Error(`Missing value for --${spec.name}`);
  }

  if (spec.parse) {
    return spec.parse(nextValue, index, spec.name);
  }
  if (spec.type === 'integer') {
    return parseInteger(nextValue, index, spec.name);
  }
  if (spec.type === 'string-list') {
    return parseStringList(nextValue);
  }
  return nextValue;
}

export function parseArgv(
  argv: string[],
  optionDefinitions: ArgOptionDefinition[],
  options: ParseArgvOptions = {},
): ParsedArgv {
  const strictUnknown = options.strictUnknown ?? false;
  const specByName = buildSpecLookup(optionDefinitions);
  const parsed: Record<string, unknown> = {};
  const positional: string[] = [];
  const unknownOptions: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    if (arg === '--') {
      positional.push(...argv.slice(index + 1));
      break;
    }

    const equalsIndex = arg.indexOf('=');
    const hasEquals = equalsIndex >= 0;
    const flag = hasEquals ? arg.slice(0, equalsIndex) : arg;
    const value = hasEquals ? arg.slice(equalsIndex + 1) : undefined;
    let optionName = flag.slice(2);
    let isNegated = false;

    if (!hasEquals && optionName.startsWith('no-')) {
      isNegated = true;
      optionName = optionName.slice(3);
    }

    const spec = specByName.get(optionKey(optionName));
    if (!spec) {
      unknownOptions.push(arg);
      if (!strictUnknown) {
        positional.push(arg);
      }
      continue;
    }

    if (spec.type === 'boolean') {
      if (isNegated) {
        if (!spec.allowNegated) {
          unknownOptions.push(arg);
          if (!strictUnknown) {
            positional.push(arg);
          }
          continue;
        }
        appendOption(parsed, spec, false);
        continue;
      }

      if (hasEquals) {
        if (spec.allowEquals === false) {
          unknownOptions.push(arg);
          if (!strictUnknown) {
            positional.push(arg);
          }
          continue;
        }
        appendOption(parsed, spec, parseBoolean(value ?? '', index, spec.name));
        continue;
      }

      appendOption(parsed, spec, true);
      continue;
    }

    if (spec.type === 'string' || spec.type === 'integer' || spec.type === 'string-list') {
      const nextValue = hasEquals ? undefined : argv[index + 1];
      const resolved = resolveValue(spec, index, hasEquals, value, nextValue);
      appendOption(parsed, spec, resolved);
      if (!hasEquals) {
        index += 1;
      }
      continue;
    }

    unknownOptions.push(arg);
    if (!strictUnknown) {
      positional.push(arg);
    }
  }

  applyDefaults(parsed, optionDefinitions);
  return {
    options: parsed,
    positional,
    unknownOptions,
  };
}
