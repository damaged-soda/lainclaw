import {
  getActiveTraceId,
  isLangfuseTracingReady,
  runLangfuseOperationSafely,
  startObservation,
} from "../observability/langfuse.js";

export interface DebugLogPayload {
  [key: string]: unknown;
}

export interface DebugObservationContent {
  input?: unknown;
  output?: unknown;
  metadata?: DebugLogPayload;
}

const PREFERRED_DEBUG_INPUT_KEYS = [
  "systemPrompt",
  "request",
  "requestContext",
  "message",
  "messages",
  "memorySnippet",
  "payload",
  "details",
] as const;

const PREFERRED_DEBUG_OUTPUT_KEYS = [
  "output",
  "result",
  "response",
  "error",
] as const;

const CORRELATION_METADATA_KEYS = [
  "requestId",
  "sessionKey",
  "sessionId",
  "provider",
  "profileId",
  "route",
] as const;

function debugReplacer() {
  const seen = new WeakSet<object>();
  return (_key: string, value: unknown) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "function") {
      return `[Function ${value.name || "anonymous"}]`;
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }
    return value;
  };
}

function normalizePayload(payload: DebugLogPayload): DebugLogPayload {
  return JSON.parse(JSON.stringify(payload, debugReplacer())) as DebugLogPayload;
}

function splitPayload(payload: DebugLogPayload): { metadata: DebugLogPayload; details: DebugLogPayload } {
  const metadata: DebugLogPayload = {};
  const details: DebugLogPayload = {};

  for (const [key, value] of Object.entries(payload)) {
    if ((CORRELATION_METADATA_KEYS as readonly string[]).includes(key)) {
      metadata[key] = value;
    } else {
      details[key] = value;
    }
  }

  return { metadata, details };
}

function pickPromotedKey(payload: DebugLogPayload): { key: string; target: "input" | "output" } | undefined {
  for (const key of PREFERRED_DEBUG_INPUT_KEYS) {
    if (key in payload) {
      return { key, target: "input" };
    }
  }

  for (const key of PREFERRED_DEBUG_OUTPUT_KEYS) {
    if (key in payload) {
      return { key, target: "output" };
    }
  }

  return undefined;
}

export function buildDebugObservationContent(name: string, payload: DebugLogPayload): DebugObservationContent {
  const normalizedPayload = normalizePayload(payload);
  const { metadata, details } = splitPayload(normalizedPayload);
  const promoted = pickPromotedKey(details);

  if (!promoted) {
    if (Object.keys(details).length > 0) {
      return {
        input: details,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      };
    }

    return Object.keys(metadata).length > 0 ? { metadata } : {};
  }

  const { [promoted.key]: promotedValue, ...remainingDetails } = details;
  return {
    [promoted.target]: promotedValue,
    ...(Object.keys({ ...metadata, ...remainingDetails }).length > 0
      ? { metadata: { ...metadata, ...remainingDetails } }
      : {}),
  };
}

export function writeDebugLog(name: string, payload: DebugLogPayload): void {
  if (!isLangfuseTracingReady() || !getActiveTraceId()) {
    return;
  }

  const content = buildDebugObservationContent(name, payload);
  runLangfuseOperationSafely(() => {
    startObservation(
      name,
      {
        level: "DEBUG",
        ...content,
      },
      { asType: "event" },
    );
  }, `debug.${name}`);
}

export function writeDebugLogIfEnabled(enabled: boolean | undefined, name: string, payload: DebugLogPayload): void {
  if (!enabled) {
    return;
  }
  writeDebugLog(name, payload);
}
