import fs from "node:fs/promises";
import { ToolContext, ToolSpec } from "../types.js";
import { resolveWorkspacePath } from "../pathGuards.js";
import { resolveSkillReadRoots } from "../../skills/index.js";

const DEFAULT_LIMIT = 200;
const DEFAULT_MAX_BYTES = 200 * 1024;

function buildReadNotice(params: {
  startLine: number;
  returnedLines: number;
  totalLines: number;
  truncatedByLines: boolean;
  truncatedByBytes: boolean;
  nextOffset?: number;
}): string {
  if (!params.truncatedByLines && !params.truncatedByBytes) {
    return "";
  }

  const reasons: string[] = [];
  if (params.truncatedByLines) {
    reasons.push(`showing lines ${params.startLine}-${params.startLine + params.returnedLines - 1} of ${params.totalLines}`);
  }
  if (params.truncatedByBytes) {
    reasons.push("output capped by maxBytes");
  }

  const nextOffsetText =
    typeof params.nextOffset === "number" ? ` Use offset=${params.nextOffset} to continue.` : "";
  return `\n\n[${reasons.join("; ")}.${nextOffsetText}]`;
}

export const readTool: ToolSpec = {
  name: "read",
  description: "读取当前工作区中的文件内容，支持 offset/limit 分页。",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "要读取的文件路径。",
      },
      file_path: {
        type: "string",
        description: "path 的兼容别名。",
      },
      offset: {
        type: "number",
        description: "起始行号，1-based，默认 1。",
      },
      limit: {
        type: "number",
        description: `最多返回多少行，默认 ${DEFAULT_LIMIT}。`,
      },
      maxBytes: {
        type: "number",
        description: `本次返回的最大字节数，默认 ${DEFAULT_MAX_BYTES}。`,
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
          tool: "read",
          message: "path is required",
        },
      };
    }

    const offsetValue =
      typeof args.offset === "number" && Number.isFinite(args.offset) && args.offset > 0
        ? Math.floor(args.offset)
        : 1;
    const limitValue =
      typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit > 0
        ? Math.floor(args.limit)
        : DEFAULT_LIMIT;
    const maxBytes =
      typeof args.maxBytes === "number" && Number.isFinite(args.maxBytes) && args.maxBytes > 0
        ? Math.floor(args.maxBytes)
        : DEFAULT_MAX_BYTES;

    try {
      const cwd = context.cwd || process.cwd();
      const targetPath = await resolveWorkspacePath(cwd, rawPath, resolveSkillReadRoots(cwd));
      const stats = await fs.stat(targetPath);
      if (!stats.isFile()) {
        return {
          ok: false,
          error: {
            code: "execution_error",
            tool: "read",
            message: "target path is not a file",
          },
        };
      }

      const rawContent = await fs.readFile(targetPath, "utf8");
      const normalized = rawContent.replace(/\r\n/g, "\n");
      const lines = normalized.split("\n");
      const totalLines = lines.length;
      const startIndex = Math.max(0, offsetValue - 1);
      const selectedLines = lines.slice(startIndex, startIndex + limitValue);
      let content = selectedLines.join("\n");

      const contentBytes = Buffer.byteLength(content, "utf8");
      const truncatedByBytes = contentBytes > maxBytes;
      if (truncatedByBytes) {
        content = Buffer.from(content, "utf8").subarray(0, maxBytes).toString("utf8");
      }

      const truncatedByLines = startIndex + selectedLines.length < totalLines;
      const notice = buildReadNotice({
        startLine: startIndex + 1,
        returnedLines: selectedLines.length,
        totalLines,
        truncatedByLines,
        truncatedByBytes,
        nextOffset: truncatedByLines ? startIndex + selectedLines.length + 1 : undefined,
      });

      return {
        ok: true,
        content: `${content}${notice}`,
        data: {
          path: targetPath,
          totalLines,
          returnedLines: selectedLines.length,
          offset: offsetValue,
          limit: limitValue,
          truncated: truncatedByLines || truncatedByBytes,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "execution_error",
          tool: "read",
          message: error instanceof Error ? error.message : "failed to read file",
        },
      };
    }
  },
};
