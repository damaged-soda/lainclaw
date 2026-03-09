import fs from "node:fs/promises";
import { ToolContext, ToolSpec } from "../types.js";
import { resolveWorkspacePath } from "../pathGuards.js";

function resolvePathArg(args: Record<string, unknown>): string {
  if (typeof args.path === "string") {
    return args.path;
  }
  if (typeof args.file_path === "string") {
    return args.file_path;
  }
  return "";
}

function resolveOldTextArg(args: Record<string, unknown>): string {
  if (typeof args.oldText === "string") {
    return args.oldText;
  }
  if (typeof args.old_string === "string") {
    return args.old_string;
  }
  return "";
}

function resolveNewTextArg(args: Record<string, unknown>): string {
  if (typeof args.newText === "string") {
    return args.newText;
  }
  if (typeof args.new_string === "string") {
    return args.new_string;
  }
  return "";
}

export const editTool: ToolSpec = {
  name: "edit",
  description: "对当前工作区文件做精确文本替换。",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "目标文件路径。",
      },
      file_path: {
        type: "string",
        description: "path 的兼容别名。",
      },
      oldText: {
        type: "string",
        description: "要替换的原始文本。",
      },
      old_string: {
        type: "string",
        description: "oldText 的兼容别名。",
      },
      newText: {
        type: "string",
        description: "替换后的文本。",
      },
      new_string: {
        type: "string",
        description: "newText 的兼容别名。",
      },
      replaceAll: {
        type: "boolean",
        description: "是否替换所有匹配，默认 false。",
      },
    },
  },
  handler: async (context: ToolContext, args: Record<string, unknown>) => {
    const rawPath = resolvePathArg(args);
    const oldText = resolveOldTextArg(args);
    const newText = resolveNewTextArg(args);

    if (!rawPath.trim()) {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "edit",
          message: "path is required",
        },
      };
    }
    if (!oldText) {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "edit",
          message: "oldText or old_string is required",
        },
      };
    }
    if (
      typeof args.newText !== "string" &&
      typeof args.new_string !== "string" &&
      newText.length === 0
    ) {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "edit",
          message: "newText or new_string is required",
        },
      };
    }

    try {
      const targetPath = await resolveWorkspacePath(context.cwd || process.cwd(), rawPath);
      const original = await fs.readFile(targetPath, "utf8");
      const updated =
        args.replaceAll === true ? original.replaceAll(oldText, newText) : original.replace(oldText, newText);

      if (updated === original) {
        return {
          ok: false,
          error: {
            code: "execution_error",
            tool: "edit",
            message: "oldText was not found in file",
          },
        };
      }

      await fs.writeFile(targetPath, updated, "utf8");
      return {
        ok: true,
        content: `Edited ${targetPath}`,
        data: {
          path: targetPath,
          replaceAll: args.replaceAll === true,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "edit",
          message: error instanceof Error ? error.message : "failed to edit file",
        },
      };
    }
  },
};
