import process from "node:process";
import { ToolContext, ToolSpec } from "../types.js";

export const pwdTool: ToolSpec = {
  name: "shell.pwd",
  description: "返回当前工作目录",
  inputSchema: {
    type: "object",
    properties: {},
  },
  handler: (context: ToolContext) => {
    const cwd = context.cwd || process.cwd();
    return {
      ok: true,
      content: cwd,
      data: {
        cwd,
      },
    };
  },
};
