import { ValidationError } from "../shared/types.js";
import type { CoreErrorCode, CoreEventSink } from "./contracts.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export function isCoreErrorCode(value: string | undefined): value is CoreErrorCode {
  return (
    value === "VALIDATION_ERROR" ||
    value === "MISSING_PROVIDER" ||
    value === "SESSION_FAILURE" ||
    value === "RUNTIME_FAILURE" ||
    value === "TOOL_FAILURE" ||
    value === "INTERNAL_ERROR"
  );
}

export function toValidationError(error: unknown, fallback: CoreErrorCode): ValidationError {
  if (error instanceof ValidationError) {
    const code = typeof error.code === "string" ? error.code : undefined;
    if (isCoreErrorCode(code)) {
      return error;
    }
    return new ValidationError(error.message, fallback);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ValidationError(message || "agent request failed", fallback);
}

export async function withFailureMapping<T>(
  stage: string,
  requestId: string,
  sessionKey: string,
  fallbackCode: CoreErrorCode,
  emitEvent: CoreEventSink,
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const normalized = toValidationError(error, fallbackCode);
    await emitEvent({
      level: "log",
      requestId,
      at: nowIso(),
      code: normalized.code as CoreErrorCode,
      name: `agent.request.${stage}.failed`,
      stage,
      message: normalized.message,
      sessionKey,
      payload: { code: normalized.code },
    });
    throw normalized;
  }
}
