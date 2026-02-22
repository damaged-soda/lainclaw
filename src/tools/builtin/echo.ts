import { ToolContext, ToolSpec } from "../types.js";

export const echoTool: ToolSpec = {
  name: "tools.echo",
  description: "回显输入内容",
  inputSchema: {
    type: "object",
    required: ["message"],
    properties: {
      message: {
        type: "string",
        description: "需要回显的消息",
      },
    },
  },
  handler: (_context: ToolContext, args: Record<string, unknown>) => {
    const message = typeof args.message === "string" ? args.message : "";
    return {
      ok: true,
      content: message,
      data: {
        message,
      },
    };
  },
};
