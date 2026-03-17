import { getPathReportEntry } from "../../paths/index.js";
import { ToolSpec } from "../types.js";

export const pathDescribeTool: ToolSpec = {
  name: "path_describe",
  description: "解释某个可见系统路径的绝对路径、用途和默认操作。",
  inputSchema: {
    type: "object",
    required: ["key"],
    properties: {
      key: {
        type: "string",
        description: "系统路径 key，例如 workspace 或 memory。",
      },
    },
  },
  handler: async (_context, args) => {
    if (typeof args.key !== "string" || !args.key.trim()) {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "path_describe",
          message: "key is required",
        },
      };
    }

    const entry = getPathReportEntry(args.key, undefined, { visibility: "visible" });
    if (!entry) {
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "path_describe",
          message: `unknown visible path: ${args.key}`,
        },
      };
    }

    return {
      ok: true,
      content: JSON.stringify(entry, null, 2),
      data: entry,
    };
  },
};
