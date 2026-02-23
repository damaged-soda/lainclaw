import fs from "node:fs/promises";
import path from "node:path";
import { ToolContext, ToolSpec } from "../types.js";

export const writeFileTool: ToolSpec = {
  name: "fs.write_file",
  description: "覆盖写入文件内容",
  inputSchema: {
    type: "object",
    required: ["path", "content"],
    properties: {
      path: {
        type: "string",
        description: "目标文件路径（相对当前工作目录或绝对路径）",
      },
      content: {
        type: "string",
        description: "要写入的文本内容",
      },
      createDir: {
        type: "boolean",
        description: "父目录不存在时是否自动创建",
      },
    },
  },
  handler: async (context: ToolContext, args: Record<string, unknown>) => {
    const target = path.resolve(context.cwd || process.cwd(), String(args.path ?? ""));
    if (typeof args.path !== "string" || args.path.trim().length === 0) {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "fs.write_file",
          message: "path is required",
        },
      };
    }
    if (typeof args.content !== "string") {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "fs.write_file",
          message: "content must be a string",
        },
      };
    }

    try {
      const shouldCreateDir = args.createDir === true;
      if (shouldCreateDir) {
        await fs.mkdir(path.dirname(target), { recursive: true });
      }
      await fs.writeFile(target, args.content, "utf-8");
      return {
        ok: true,
        content: `wrote ${target}`,
        data: { path: target },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "fs.write_file",
          message,
        },
      };
    }
  },
};
