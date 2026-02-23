import fs from "node:fs/promises";
import path from "node:path";
import { ToolContext, ToolSpec } from "../types.js";

export const editFileTool: ToolSpec = {
  name: "fs.edit_file",
  description: "按文本片段编辑文件内容（替换旧字符串）",
  inputSchema: {
    type: "object",
    required: ["path", "search", "replace"],
    properties: {
      path: {
        type: "string",
        description: "目标文件路径（相对当前工作目录或绝对路径）",
      },
      search: {
        type: "string",
        description: "要替换的原始文本片段（精确匹配）",
      },
      replace: {
        type: "string",
        description: "要替换成的文本",
      },
      all: {
        type: "boolean",
        description: "是否替换所有匹配，默认只替换首个",
      },
    },
  },
  handler: async (context: ToolContext, args: Record<string, unknown>) => {
    const targetPath = String(args.path ?? "");
    if (typeof args.path !== "string" || targetPath.trim().length === 0) {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "fs.edit_file",
          message: "path is required",
        },
      };
    }
    const search = typeof args.search === "string" ? args.search : "";
    const replace = typeof args.replace === "string" ? args.replace : "";
    if (search.length === 0) {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "fs.edit_file",
          message: "search must be a non-empty string",
        },
      };
    }

    const target = path.resolve(context.cwd || process.cwd(), targetPath);
    try {
      const raw = await fs.readFile(target, "utf-8");
      const next = args.all === true ? raw.replaceAll(search, replace) : raw.replace(search, replace);
      if (next === raw) {
        return {
          ok: false,
          error: {
            code: "execution_error",
            tool: "fs.edit_file",
            message: "search text not found",
          },
        };
      }
      await fs.writeFile(target, next, "utf-8");
      return {
        ok: true,
        content: `edited ${target}`,
        data: { path: target },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "fs.edit_file",
          message,
        },
      };
    }
  },
};
