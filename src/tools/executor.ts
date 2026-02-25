import {
  ToolCall,
  ToolContext,
  ToolExecutionLog,
  ToolInputSchema,
  ToolResult,
  ToolErrorCode,
  ToolError,
} from "./types.js";
import { getTool } from "./registry.js";

function parseArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return {};
  }
  return { ...(args as Record<string, unknown>) };
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is Array<unknown> {
  return Array.isArray(value);
}

function validateArgs(schema: ToolInputSchema, args: Record<string, unknown>): { valid: boolean; value: Record<string, unknown>; message: string | null } {
  const value: Record<string, unknown> = {
    ...args,
  };

  const properties = schema.properties ?? {};
  const required = Array.isArray(schema.required) ? schema.required : [];

  for (const key of required) {
    if (!(key in value)) {
      return {
        valid: false,
        value: value,
        message: `missing required argument: ${key}`,
      };
    }
  }

  for (const [key, raw] of Object.entries(value)) {
    const schemaProperty = properties[key];
    if (!schemaProperty) {
      return {
        valid: false,
        value,
        message: `unknown argument: ${key}`,
      };
    }

    if (schemaProperty.type === "string" && !isString(raw)) {
      return {
        valid: false,
        value,
        message: `argument ${key} must be string`,
      };
    }

    if (schemaProperty.type === "number" && !isNumber(raw)) {
      return {
        valid: false,
        value,
        message: `argument ${key} must be number`,
      };
    }

    if (schemaProperty.type === "boolean" && !isBoolean(raw)) {
      return {
        valid: false,
        value,
        message: `argument ${key} must be boolean`,
      };
    }

    if (schemaProperty.type === "object" && !isObject(raw)) {
      return {
        valid: false,
        value,
        message: `argument ${key} must be object`,
      };
    }

    if (schemaProperty.type === "array" && !isArray(raw)) {
      return {
        valid: false,
        value,
        message: `argument ${key} must be array`,
      };
    }
  }

  return {
    valid: true,
    value,
    message: null,
  };
}

function createExecutionError(
  toolName: string,
  code: ToolErrorCode,
  message: string,
  durationMs: number = 0,
): ToolResult {
  return {
    ok: false,
    meta: {
      tool: toolName,
      durationMs,
    },
    error: {
      code,
      tool: toolName,
      message,
    },
  };
}

function normalizeToolError(toolName: string, rawError: unknown): ToolError {
  if (
    rawError &&
    typeof rawError === "object" &&
    "code" in rawError &&
    typeof (rawError as { code?: unknown }).code === "string" &&
    "message" in rawError &&
    typeof (rawError as { message?: unknown }).message === "string"
  ) {
    const { code, message } = rawError as { code?: string; message?: string; tool?: string };
    return {
      code: code as ToolErrorCode,
      tool: typeof (rawError as { tool?: unknown }).tool === "string"
        ? (rawError as { tool?: string }).tool!
        : toolName,
      message: (message ?? "tool execution failed").trim() || "tool execution failed",
    };
  }

  return {
    code: "execution_error",
    tool: toolName,
    message: "tool execution failed",
  };
}

export async function executeTool(call: ToolCall, context: ToolContext): Promise<ToolExecutionLog> {
  const toolName = String(call.name || "").trim();
  const tool = getTool(toolName);
  if (!tool) {
    return {
      call: {
        ...call,
        id: call.id || `lc-tool-${Date.now()}`,
      },
      result: {
        ok: false,
        meta: {
          tool: toolName || "<unknown>",
          durationMs: 0,
        },
        error: {
          code: "tool_not_found",
          tool: toolName || "<unknown>",
          message: `tool not found: ${toolName}`,
        },
      },
    };
  }

  const normalizedCall = {
    ...call,
    id: call.id || `lc-tool-${Date.now()}-${Math.floor(Math.random() * 10000).toString(16).padStart(4, "0")}`,
  };

  const rawArgs = parseArgs(call.args);
  const validation = validateArgs(tool.inputSchema, rawArgs);
  if (!validation.valid) {
    return {
      call: normalizedCall,
      result: createExecutionError(tool.name, "invalid_args", validation.message || "invalid arguments", 0),
    };
  }

  const started = Date.now();
  try {
    const handlerResult = await Promise.resolve(tool.handler(context, validation.value));
    const normalizedResult = {
      ...handlerResult,
      meta: {
        tool: tool.name,
        durationMs: Date.now() - started,
        ...(handlerResult.meta || {}),
      },
    };

    if (normalizedResult.ok) {
      return { call: normalizedCall, result: normalizedResult };
    }

    if (!normalizedResult.error) {
      return {
        call: normalizedCall,
        result: createExecutionError(tool.name, "execution_error", "tool execution failed", Date.now() - started),
      };
    }

    normalizedResult.error = normalizeToolError(tool.name, normalizedResult.error);

    return { call: normalizedCall, result: normalizedResult };
  } catch (error) {
    return {
      call: normalizedCall,
      result: createExecutionError(
        tool.name,
        "execution_error",
        error instanceof Error ? error.message : "unknown error",
        Date.now() - started,
      ),
    };
  }
}
