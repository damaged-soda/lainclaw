import { ToolContext, ToolSpec } from "../types.js";

export const timeNowTool: ToolSpec = {
  name: "time.now",
  description: "返回当前时间戳与 ISO 时间",
  inputSchema: {
    type: "object",
    properties: {},
  },
  handler: (_context: ToolContext) => {
    const now = new Date();
    return {
      ok: true,
      content: `timestamp=${now.getTime()}, iso=${now.toISOString()}`,
      data: {
        timestamp: now.getTime(),
        iso: now.toISOString(),
      },
    };
  },
};
