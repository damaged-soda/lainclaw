export type CommandExitCode = number;

export interface CommandContext {
  command: string;
  args: string[];
  argv: string[];
}

export type CommandHandler = (context: CommandContext) => Promise<CommandExitCode>;

export interface CommandRoute {
  command: string;
  handler: CommandHandler;
  description?: string;
}
