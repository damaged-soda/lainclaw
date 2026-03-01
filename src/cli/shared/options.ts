import { Command, Option } from 'commander';

const TRUE_VALUES = new Set(['1', 'true', 'on', 'yes']);
const FALSE_VALUES = new Set(['0', 'false', 'off', 'no']);

export function parseOptionalBoolean(raw?: string): boolean {
  if (raw === undefined) {
    return true;
  }

  const normalized = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  throw new Error(`Invalid value for boolean option: ${raw}`);
}

export function parseCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function parsePositiveInt(raw: string, label: string): number {
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized) || normalized.length === 0) {
    throw new Error(`Invalid value for ${label}: ${raw}`);
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid value for ${label}: ${raw}`);
  }
  return parsed;
}

export function buildProviderOption(description = 'Model provider override.'): Option {
  return new Option('--provider <provider>', description);
}

export function buildProfileOption(description = 'Model profile override.'): Option {
  return new Option('--profile <profile>', description);
}

export function buildWithToolsOption(description = 'Enable/disable tool calls.'): Option {
  return new Option('--with-tools [value]', description).argParser(parseOptionalBoolean).default(undefined);
}

export function buildNoWithToolsOption(description = 'Disable tool calls.'): Option {
  return new Option('--no-with-tools', description);
}

export function buildToolAllowOption(description = 'Limit allowed tool names.'): Option {
  return new Option('--tool-allow <tools>', description).argParser(parseCsv);
}

export function buildBooleanValueOption(name: string, description: string): Option {
  return new Option(`--${name} [value]`, description).argParser(parseOptionalBoolean).default(undefined);
}

export function buildNoBooleanOption(name: string, description: string): Option {
  return new Option(`--no-${name}`, description);
}

export function buildMemoryOption(description = 'Enable/disable memory persistence.'): Option {
  return buildBooleanValueOption('memory', description);
}

export function buildNoMemoryOption(description = 'Disable memory persistence.'): Option {
  return buildNoBooleanOption('memory', description);
}

export interface AddModelOptionsConfig {
  includeMemory?: boolean;
  providerDescription?: string;
  profileDescription?: string;
  withToolsDescription?: string;
  toolAllowDescription?: string;
  noWithToolsDescription?: string;
  memoryDescription?: string;
  noMemoryDescription?: string;
}

export function addModelOptions(
  command: Command,
  options: AddModelOptionsConfig = {},
): void {
  command.addOption(buildProviderOption(options.providerDescription));
  command.addOption(buildProfileOption(options.profileDescription));
  command.addOption(buildWithToolsOption(options.withToolsDescription));
  command.addOption(buildNoWithToolsOption(options.noWithToolsDescription));
  command.addOption(buildToolAllowOption(options.toolAllowDescription));
  if (options.includeMemory) {
    command.addOption(buildMemoryOption(options.memoryDescription));
    command.addOption(buildNoMemoryOption(options.noMemoryDescription));
  }
}

