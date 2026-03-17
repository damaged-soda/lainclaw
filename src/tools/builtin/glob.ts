import fs from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import { ToolContext, ToolSpec } from "../types.js";
import { resolveAllowedPath } from "../pathGuards.js";
import { resolveVisibleRootEntry } from "./pathRoots.js";

const DEFAULT_LIMIT = 200;

async function collectMatches(
  currentPath: string,
  baseRoot: string,
  pattern: string,
  matches: string[],
  limit: number,
): Promise<void> {
  if (matches.length >= limit) {
    return;
  }

  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (matches.length >= limit) {
      return;
    }

    const entryPath = path.join(currentPath, entry.name);
    const relativePath = path.relative(baseRoot, entryPath).split(path.sep).join(path.posix.sep);
    if (entry.isDirectory()) {
      await collectMatches(entryPath, baseRoot, pattern, matches, limit);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (minimatch(relativePath, pattern, { dot: true })) {
      matches.push(entryPath);
    }
  }
}

export const globTool: ToolSpec = {
  name: "glob",
  description: "在可见系统路径下按 glob 模式查找文件。",
  inputSchema: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description: "glob 模式，例如 **/*.md。",
      },
      root: {
        type: "string",
        description: "可见系统路径 key，默认 workspace。",
      },
      path: {
        type: "string",
        description: "相对 root 的搜索起点目录，默认当前 root。",
      },
      limit: {
        type: "number",
        description: `最多返回多少个匹配，默认 ${DEFAULT_LIMIT}。`,
      },
    },
  },
  handler: async (_context: ToolContext, args: Record<string, unknown>) => {
    if (typeof args.pattern !== "string" || !args.pattern.trim()) {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "glob",
          message: "pattern is required",
        },
      };
    }

    try {
      const rootEntry = resolveVisibleRootEntry(args.root, "glob");
      const searchRoot = await resolveAllowedPath(
        rootEntry.path,
        typeof args.path === "string" ? args.path : ".",
      );
      const stats = await fs.stat(searchRoot);
      if (!stats.isDirectory()) {
        return {
          ok: false,
          error: {
            code: "execution_error",
            tool: "glob",
            message: "search root is not a directory",
          },
        };
      }

      const limit =
        typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit > 0
          ? Math.floor(args.limit)
          : DEFAULT_LIMIT;
      const matches: string[] = [];
      await collectMatches(searchRoot, rootEntry.path, args.pattern.trim(), matches, limit + 1);
      const truncated = matches.length > limit;
      const selected = truncated ? matches.slice(0, limit) : matches;

      return {
        ok: true,
        content: selected.length > 0
          ? [
            ...selected.map((entryPath) => path.relative(rootEntry.path, entryPath) || path.basename(entryPath)),
            ...(truncated ? [`[showing ${selected.length} matches; refine the pattern to continue]`] : []),
          ].join("\n")
          : "[no matches]",
        data: {
          root: rootEntry.key,
          rootPath: rootEntry.path,
          searchRoot,
          pattern: args.pattern.trim(),
          truncated,
          matches: selected,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "glob",
          message: error instanceof Error ? error.message : "failed to glob files",
        },
      };
    }
  },
};
