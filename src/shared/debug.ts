export interface DebugLogPayload {
  [key: string]: unknown;
}

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

export function writeDebugLog(name: string, payload: DebugLogPayload): void {
  const message = {
    debug: true,
    name,
    at: new Date().toISOString(),
    ...payload,
  };
  process.stdout.write(`[debug] ${JSON.stringify(message, debugReplacer(), 2)}\n`);
}

export function writeDebugLogIfEnabled(enabled: boolean | undefined, name: string, payload: DebugLogPayload): void {
  if (!enabled) {
    return;
  }
  writeDebugLog(name, payload);
}
