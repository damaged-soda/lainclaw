import fs from "node:fs/promises";
import path from "node:path";
import type { ToolContext, ToolSpec } from "../types.js";

type DirEntry = {
  type: "file" | "directory";
  name: string;
  path: string;
};

type DirNode = {
  depth: number;
  path: string;
  children: DirEntry[];
};

async function listDirEntries(targetPath: string, recursive: boolean, maxDepth: number, currentDepth = 0): Promise<DirNode[]> {
  if (!Number.isFinite(maxDepth) || maxDepth < 1) {
    maxDepth = 1;
  }

  const dirNode: DirNode = {
    depth: currentDepth,
    path: targetPath,
    children: [],
  };
  const result: DirNode[] = [dirNode];

  if (currentDepth >= maxDepth) {
    return result;
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });

  for (const entry of entries) {
    const resolved = path.join(targetPath, entry.name);
    if (entry.isDirectory() && recursive) {
      result.push(...(await listDirEntries(resolved, true, maxDepth, currentDepth + 1)));
      dirNode.children.push({
        type: "directory",
        name: entry.name,
        path: resolved,
      });
      continue;
    }

    dirNode.children.push({
      type: "file",
      name: entry.name,
      path: resolved,
    });
  }

  return result;
}

export const listDirTool: ToolSpec = {
  name: "fs.list_dir",
  description: "列出目录内容",
  inputSchema: {
    type: "object",
    required: ["path"],
    properties: {
      path: {
        type: "string",
        description: "要列出的路径",
      },
      recursive: {
        type: "boolean",
        description: "是否递归",
      },
      maxDepth: {
        type: "number",
        description: "递归深度上限",
      },
    },
  },
  handler: async (_context: ToolContext, args: Record<string, unknown>) => {
    const cwd = process.cwd();
    const requestPath = typeof args.path === "string" && args.path.trim().length > 0 ? args.path.trim() : ".";
    const recursive = args.recursive === true;
    const maxDepth = Math.max(1, Number.isFinite(Number(args.maxDepth)) ? Number(args.maxDepth) : 4);

    const target = path.resolve(cwd, requestPath);

    try {
      const nodes = await listDirEntries(target, recursive, maxDepth);
      return {
        ok: true,
        content: `listed ${nodes.length} paths under ${target}`,
        data: {
          target,
          recursive,
          maxDepth,
          nodes,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "fs.list_dir",
          message,
        },
      };
    }
  },
};
