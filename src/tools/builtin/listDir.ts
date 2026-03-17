import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { ToolContext, ToolSpec } from "../types.js";
import { resolveAllowedPath } from "../pathGuards.js";
import { resolveVisibleRootEntry } from "./pathRoots.js";

const DEFAULT_LIMIT = 200;

type DirectoryEntryKind = "directory" | "file" | "symlink" | "other";

function normalizeKind(entry: Dirent): DirectoryEntryKind {
  if (entry.isDirectory()) {
    return "directory";
  }
  if (entry.isFile()) {
    return "file";
  }
  if (entry.isSymbolicLink()) {
    return "symlink";
  }
  return "other";
}

function compareEntries(
  left: { name: string; kind: DirectoryEntryKind },
  right: { name: string; kind: DirectoryEntryKind },
): number {
  if (left.kind !== right.kind) {
    if (left.kind === "directory") {
      return -1;
    }
    if (right.kind === "directory") {
      return 1;
    }
  }
  return left.name.localeCompare(right.name);
}

export const listDirTool: ToolSpec = {
  name: "list_dir",
  description: "列出可见系统路径下某个目录的直接内容。",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "相对 root 的目录路径，默认当前 root。",
      },
      root: {
        type: "string",
        description: "可见系统路径 key，默认 workspace。",
      },
      limit: {
        type: "number",
        description: `最多返回多少条目录项，默认 ${DEFAULT_LIMIT}。`,
      },
    },
  },
  handler: async (_context: ToolContext, args: Record<string, unknown>) => {
    try {
      const rootEntry = resolveVisibleRootEntry(args.root, "list_dir");
      const targetPath = await resolveAllowedPath(
        rootEntry.path,
        typeof args.path === "string" ? args.path : ".",
      );
      const stats = await fs.stat(targetPath);
      if (!stats.isDirectory()) {
        return {
          ok: false,
          error: {
            code: "execution_error",
            tool: "list_dir",
            message: "target path is not a directory",
          },
        };
      }

      const limit =
        typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit > 0
          ? Math.floor(args.limit)
          : DEFAULT_LIMIT;

      const entries = (await fs.readdir(targetPath, { withFileTypes: true }))
        .map((entry) => ({
          name: entry.name,
          kind: normalizeKind(entry),
          path: path.join(targetPath, entry.name),
        }))
        .sort(compareEntries);
      const selected = entries.slice(0, limit);
      const truncated = selected.length < entries.length;

      return {
        ok: true,
        content: [
          targetPath,
          ...selected.map((entry) => `[${entry.kind}] ${entry.name}`),
          ...(truncated ? [`[showing ${selected.length} of ${entries.length}]`] : []),
        ].join("\n"),
        data: {
          root: rootEntry.key,
          path: targetPath,
          truncated,
          entries: selected,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "list_dir",
          message: error instanceof Error ? error.message : "failed to list directory",
        },
      };
    }
  },
};
