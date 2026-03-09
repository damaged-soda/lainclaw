import { ToolContext, ToolSpec } from "../types.js";
import { applyPatchInWorkspace } from "../applyPatchRuntime.js";

export const applyPatchTool: ToolSpec = {
  name: "apply_patch",
  description: "通过 apply_patch 格式一次修改多个文件或多个位置。",
  inputSchema: {
    type: "object",
    required: ["input"],
    properties: {
      input: {
        type: "string",
        description: "包含 *** Begin Patch 和 *** End Patch 的 patch 文本。",
      },
    },
  },
  handler: async (context: ToolContext, args: Record<string, unknown>) => {
    if (typeof args.input !== "string" || !args.input.trim()) {
      return {
        ok: false,
        error: {
          code: "invalid_args",
          tool: "apply_patch",
          message: "input must be a non-empty string",
        },
      };
    }

    try {
      const result = await applyPatchInWorkspace(args.input, context.cwd || process.cwd());
      return {
        ok: true,
        content: result.text,
        data: result.summary,
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "apply_patch",
          message: error instanceof Error ? error.message : "failed to apply patch",
        },
      };
    }
  },
};
