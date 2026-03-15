import fs from "node:fs/promises";
import path from "node:path";

function isSubpath(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveExistingPath(targetPath: string): Promise<string> {
  const unresolvedParts: string[] = [];
  let current = path.resolve(targetPath);

  while (true) {
    try {
      const resolved = await fs.realpath(current);
      return path.resolve(resolved, ...unresolvedParts.reverse());
    } catch (error) {
      const parent = path.dirname(current);
      if (parent === current) {
        throw error;
      }
      unresolvedParts.push(path.basename(current));
      current = parent;
    }
  }
}

export function resolvePathFromCwd(cwd: string, inputPath: string): string {
  const value = inputPath.trim();
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(cwd, value);
}

export async function resolveWorkspacePath(
  cwd: string,
  inputPath: string,
  allowedRoots: string[] = [],
): Promise<string> {
  const rootPath = await fs.realpath(cwd).catch(() => path.resolve(cwd));
  const normalizedAllowedRoots = await Promise.all(
    allowedRoots.map(async (root) => fs.realpath(root).catch(() => path.resolve(root))),
  );
  const candidatePath = resolvePathFromCwd(rootPath, inputPath);
  const resolvedPath = await resolveExistingPath(candidatePath).catch(() => candidatePath);

  if (
    !isSubpath(rootPath, resolvedPath)
    && !normalizedAllowedRoots.some((allowedRoot) => isSubpath(allowedRoot, resolvedPath))
  ) {
    throw new Error(`path escapes workspace root: ${inputPath}`);
  }

  return resolvedPath;
}
