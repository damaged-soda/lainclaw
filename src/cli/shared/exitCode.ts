import { Command } from 'commander';

function getRootCommand(command: Command): Command {
  let current = command;
  while (current.parent) {
    current = current.parent;
  }
  return current;
}

export function setExitCode(command: Command, code: number): void {
  let current: Command | undefined = command;
  while (current) {
    (current as { exitCode?: number }).exitCode = code;
    current = current.parent;
  }

  process.exitCode = code;
  const root = getRootCommand(command);
  (root as { exitCode?: number }).exitCode = code;
}

