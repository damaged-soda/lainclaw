import fs from "node:fs/promises";
import path from "node:path";
import { ToolContext, ToolSpec } from "../types.js";

export const readFileTool: ToolSpec = {
  name: "fs.read_file",
  description: "读取文件内容（可配置上限）",
  inputSchema: {
    type: "object",
    required: ["path"],
    properties: {
      path: {
        type: "string",
        description: "要读取的文件路径",
      },
      maxBytes: {
        type: "number",
        description: "读取上限字节数，默认 204800",
      },
    },
  },
  handler: async (_context: ToolContext, args: Record<string, unknown>) => {
    const cwd = process.cwd();
    const maxBytesRaw = Number(args.maxBytes);
    const maxBytes = Number.isFinite(maxBytesRaw) && maxBytesRaw > 0 ? Math.floor(maxBytesRaw) : 204800;

    const target = path.resolve(cwd, String(args.path));
    try {
      const stat = await fs.stat(target);
      if (!stat.isFile()) {
        return {
          ok: false,
          error: {
            code: "execution_error",
            tool: "fs.read_file",
            message: "target path is not a file",
          },
        };
      }
      if (stat.size > maxBytes) {
        return {
          ok: false,
          error: {
            code: "execution_error",
            tool: "fs.read_file",
            message: `file size exceeds maxBytes (${stat.size} > ${maxBytes})`,
          },
        };
      }

      const content = await fs.readFile(target, "utf-8");
      return {
        ok: true,
        content,
        data: {
          path: target,
          size: stat.size,
          maxBytes,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "fs.read_file",
          message,
        },
      };
    }
  },
};
