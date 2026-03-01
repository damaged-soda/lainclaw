import {
  printCommandUsage,
  printGlobalUsage,
  printSubcommandUsage,
} from './spec/help.js';

export {
  printCommandUsage,
  printSubcommandUsage,
  printGlobalUsage,
};

export function printUsage(command?: string): string {
  if (command) {
    return printCommandUsage(command);
  }
  return printGlobalUsage();
}
