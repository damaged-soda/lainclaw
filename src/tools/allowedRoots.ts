import { resolveAuthDirectory } from "../auth/configStore.js";
import { resolveBuiltinSkillsDir } from "../skills/index.js";

export function resolveToolReadRoots(): string[] {
  return [
    resolveBuiltinSkillsDir(),
    resolveAuthDirectory(),
  ];
}

export function resolveToolWriteRoots(): string[] {
  return [resolveAuthDirectory()];
}
