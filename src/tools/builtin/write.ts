import fs from "node:fs/promises";
import path from "node:path";
import { ToolContext, ToolSpec } from "../types.js";
import { resolveWorkspacePath } from "../pathGuards.js";

export const writeTool: ToolSpec = {
  name: "write",
  description: "在当前工作区创建或覆盖文件。",
  inputSchema: {
    type: "object",
    required: ["content"],
    properties: {
      path: {
        type: "string",
        description: "目标文件路径。",
      },
      file_path: {
        type: "string",
        description: "path 的兼容别名。",
      },
      content: {
        type: "string",
        description: "写入的文本内容。",
      },
      createDir: {
        type: "boolean",
        description: "父目录不存在时是否自动创建，默认 false。",
      },
    },
  },
  handler: async (context: ToolContext, args: Record<string, unknown>) => {
    const rawPath =
      typeof args.path === "string"
        ? args.path
        : typeof args.file_path === "string"
          ? args.file_path
          : "";

    if (!rawPath.trim()) {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "write",
          message: "path is required",
        },
      };
    }
    if (typeof args.content !== "string") {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "write",
          message: "content must be a string",
        },
      };
    }

    try {
      const targetPath = await resolveWorkspacePath(context.cwd || process.cwd(), rawPath);
      if (args.createDir === true) {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
      }
      await fs.writeFile(targetPath, args.content, "utf8");
      return {
        ok: true,
        content: `Wrote ${targetPath}`,
        data: {
          path: targetPath,
          bytes: Buffer.byteLength(args.content, "utf8"),
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "write",
          message: error instanceof Error ? error.message : "failed to write file",
        },
      };
    }
  },
};
