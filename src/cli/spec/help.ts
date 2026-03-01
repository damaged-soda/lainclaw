import {
  type CommandOptionSpec,
  type CommandUsageSpec,
  COMMAND_DEFINITIONS,
  GLOBAL_EXAMPLES,
  GLOBAL_NOTES,
  getCommandSpec,
} from './commands.js';

function getCommandUsageLines(command: string, spec: CommandUsageSpec | undefined): string[] {
  const lines: string[] = [];
  if (!spec) {
    return lines;
  }

  if (spec.subcommands && spec.subcommands.length > 0) {
    for (const subcommand of spec.subcommands) {
      lines.push(`  lainclaw ${command} ${subcommand.usage}`);
    }
    return lines;
  }

  if (spec.usageLines && spec.usageLines.length > 0) {
    for (const usage of spec.usageLines) {
      lines.push(`  lainclaw ${command} ${usage}`);
    }
  }
  return lines;
}

function getGlobalUsageEntries(): string[] {
  return COMMAND_DEFINITIONS.flatMap((spec) => getCommandUsageLines(spec.command, spec));
}

function getCommandExamples(spec: CommandUsageSpec | undefined): string[] {
  if (!spec) {
    return [];
  }
  return spec.examples.map((entry) => `  ${entry}`);
}

function formatOptionLine(
  option: CommandOptionSpec,
  maxUsageLength: number,
): string {
  return `  ${option.usage.padEnd(maxUsageLength)}  ${option.description}`;
}

function buildUsageOptionLines(options: CommandOptionSpec[]): string[] {
  const maxUsageLength = Math.max(
    0,
    ...options.map((option) => option.usage.length),
  );

  return options.map((option) => formatOptionLine(option, maxUsageLength));
}

export function printGlobalUsage(): string {
  const lines: string[] = [
    'Usage:',
    '  lainclaw --help',
    '  lainclaw --version',
    ...getGlobalUsageEntries(),
    '',
    'Examples:',
    ...GLOBAL_EXAMPLES.map((example) => `  ${example}`),
  ];

  if (GLOBAL_NOTES.length > 0) {
    lines.push('', ...GLOBAL_NOTES);
  }

  return lines.join('\n');
}

export function printCommandUsage(command: string): string {
  const spec = getCommandSpec(command);
  const usageLines = getCommandUsageLines(command, spec);
  if (usageLines.length === 0) {
    return printGlobalUsage();
  }

  const lines: string[] = ['Usage:', ...usageLines];

  if (spec && spec.optionDefs.length > 0) {
    lines.push('', 'Options:', ...buildUsageOptionLines(spec.optionDefs));
  }

  if (spec && spec.subcommands && spec.subcommands.length > 0) {
    lines.push('', 'Subcommands:');
    for (const subcommand of spec.subcommands) {
      lines.push(`  ${command} ${subcommand.name}`);
    }
  }

  if (spec && spec.examples.length > 0) {
    lines.push('', 'Examples:', ...getCommandExamples(spec));
  }

  if (spec && spec.notes.length > 0) {
    lines.push('', ...spec.notes);
  }

  return lines.join('\n');
}

export function printSubcommandUsage(command: string, subcommand: string): string {
  const spec = getCommandSpec(command);
  const parentSpec = spec;
  if (!parentSpec || !parentSpec.subcommands || parentSpec.subcommands.length === 0) {
    return printCommandUsage(command);
  }

  const target = parentSpec.subcommands.find((candidate) => candidate.name === subcommand);
  if (!target) {
    return printCommandUsage(command);
  }

  const lines: string[] = [
    'Usage:',
    `  lainclaw ${command} ${target.usage}`,
    '',
    target.description,
    '',
    'Options:',
  ];

  const optionDefsByName = new Map(
    parentSpec.optionDefs.map((option) => [option.name, option]),
  );
  const referencedOptions = target.optionRefs
    .map((name) => optionDefsByName.get(name))
    .filter((option): option is CommandOptionSpec => option !== undefined);
  lines.push(...buildUsageOptionLines(referencedOptions));

  if (target.examples.length > 0) {
    lines.push('', 'Examples:', ...target.examples.map((entry) => `  ${entry}`));
  }

  return lines.join('\n');
}
