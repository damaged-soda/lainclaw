import { Command } from "commander";
import { buildPathsShowReport } from "../../paths/index.js";
import { setExitCode } from "../shared/exitCode.js";
import { runCommand } from "../shared/result.js";

export async function runPathsShowCommand(): Promise<number> {
  return runCommand(async () => {
    console.log(JSON.stringify(buildPathsShowReport(), null, 2));
    return 0;
  });
}

export function buildPathsCommand(program: Command): Command {
  const command = program.command("paths").description("Inspect runtime paths.");

  command
    .command("show")
    .description("Show resolved LAINCLAW_HOME system paths.")
    .action(async (_options: never, subcommand: Command) => {
      setExitCode(subcommand, await runPathsShowCommand());
    });

  return command;
}
