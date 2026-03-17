import path from "node:path";
import { resolveBuiltinSkillsDir } from "../skills/index.js";
import { PATH_DEFS, resolveRuntimePaths, type AgentPathOp, type PathKey } from "../paths/index.js";

function uniquePaths(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => path.resolve(value))));
}

function resolveRootsForOp(op: AgentPathOp, options: { includeBuiltinSkills?: boolean } = {}): string[] {
  const paths = resolveRuntimePaths();
  const roots = (Object.keys(PATH_DEFS) as PathKey[])
    .filter((key) => (PATH_DEFS[key].ops as readonly AgentPathOp[]).includes(op))
    .map((key) => paths[key]);

  if (options.includeBuiltinSkills === true && op === "read") {
    roots.unshift(resolveBuiltinSkillsDir());
  }

  return uniquePaths(roots);
}

export function resolveToolReadRoots(): string[] {
  return resolveRootsForOp("read", { includeBuiltinSkills: true });
}

export function resolveToolWriteRoots(): string[] {
  return uniquePaths([
    ...resolveRootsForOp("write"),
    ...resolveRootsForOp("edit"),
    ...resolveRootsForOp("apply_patch"),
  ]);
}

export function resolveToolEditRoots(): string[] {
  return resolveRootsForOp("edit");
}

export function resolveToolApplyPatchRoots(): string[] {
  return resolveRootsForOp("apply_patch");
}

export function resolveToolExecRoots(): string[] {
  return resolveRootsForOp("exec");
}

export function resolveToolListDirRoots(): string[] {
  return resolveRootsForOp("list_dir");
}

export function resolveToolGlobRoots(): string[] {
  return resolveRootsForOp("glob");
}
