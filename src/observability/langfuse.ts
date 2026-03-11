import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  getActiveTraceId,
  propagateAttributes,
  startActiveObservation,
  startObservation,
  type LangfuseAgent,
  type LangfuseGeneration,
  type LangfuseObservation,
  type LangfuseTool,
} from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";

let sdk: NodeSDK | undefined;
let shutdownPromise: Promise<void> | undefined;
let warnedAboutConfig = false;
let warnedAboutStartup = false;
let warnedAboutRuntime = false;

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2000;

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function resolveConfig() {
  const publicKey = readEnv("LANGFUSE_PUBLIC_KEY");
  const secretKey = readEnv("LANGFUSE_SECRET_KEY");
  const baseUrl = readEnv("LANGFUSE_BASE_URL") ?? readEnv("LANGFUSE_HOST");
  return { publicKey, secretKey, baseUrl };
}

function hasPartialConfig(config: ReturnType<typeof resolveConfig>): boolean {
  return Boolean(config.publicKey || config.secretKey || config.baseUrl)
    && !(config.publicKey && config.secretKey && config.baseUrl);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function warnRuntimeFailure(context: string, error: unknown): void {
  if (warnedAboutRuntime) {
    return;
  }
  warnedAboutRuntime = true;
  console.warn(`[langfuse] tracing degraded in ${context}: ${toErrorMessage(error)}`);
}

export function reportLangfuseRuntimeFailure(context: string, error: unknown): void {
  warnRuntimeFailure(context, error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function initLangfuseTracing(): boolean {
  if (sdk) {
    return true;
  }

  const config = resolveConfig();
  if (!(config.publicKey && config.secretKey && config.baseUrl)) {
    if (hasPartialConfig(config) && !warnedAboutConfig) {
      warnedAboutConfig = true;
      console.warn(
        "[langfuse] tracing disabled: set LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and LANGFUSE_BASE_URL.",
      );
    }
    return false;
  }

  try {
    const nextSdk = new NodeSDK({
      spanProcessors: [
        new LangfuseSpanProcessor({
          publicKey: config.publicKey,
          secretKey: config.secretKey,
          baseUrl: config.baseUrl,
        }),
      ],
    });
    sdk = nextSdk;
    nextSdk.start();
    return true;
  } catch (error) {
    sdk = undefined;
    if (!warnedAboutStartup) {
      warnedAboutStartup = true;
      console.warn(`[langfuse] tracing disabled: ${toErrorMessage(error)}`);
    }
    return false;
  }
}

export function isLangfuseTracingReady(): boolean {
  return Boolean(sdk);
}

export async function runWithLangfuseFallback<T>(
  observedRun: (run: () => Promise<T>) => Promise<T>,
  fallbackRun: () => Promise<T>,
  context: string,
): Promise<T> {
  let settled = false;
  let failed = false;
  let result: T | undefined;
  let capturedError: unknown;

  const runOnce = async (): Promise<T> => {
    try {
      const value = await fallbackRun();
      settled = true;
      result = value;
      return value;
    } catch (error) {
      settled = true;
      failed = true;
      capturedError = error;
      throw error;
    }
  };

  try {
    return await observedRun(runOnce);
  } catch (error) {
    warnRuntimeFailure(context, error);
    if (settled) {
      if (failed) {
        throw capturedError;
      }
      return result as T;
    }
    return runOnce();
  }
}

export function runLangfuseOperationSafely(operation: () => void, context: string): void {
  try {
    operation();
  } catch (error) {
    warnRuntimeFailure(context, error);
  }
}

export async function shutdownLangfuseTracing(): Promise<void> {
  if (!sdk) {
    if (shutdownPromise) {
      await shutdownPromise;
    }
    return;
  }

  if (shutdownPromise) {
    await shutdownPromise;
    return;
  }

  const currentSdk = sdk;
  const shutdownTask = currentSdk.shutdown()
    .catch((error) => {
      warnRuntimeFailure("shutdown", error);
      return undefined;
    })
    .then(() => {
      if (sdk === currentSdk) {
        sdk = undefined;
      }
    });

  shutdownPromise = Promise.race([
    shutdownTask,
    sleep(DEFAULT_SHUTDOWN_TIMEOUT_MS).then(() => {
      warnRuntimeFailure(
        "shutdown",
        new Error(`shutdown timed out after ${DEFAULT_SHUTDOWN_TIMEOUT_MS}ms`),
      );
      if (sdk === currentSdk) {
        sdk = undefined;
      }
    }),
  ]).then(() => {
    if (sdk === currentSdk) {
      sdk = undefined;
    }
  }).finally(() => {
    shutdownPromise = undefined;
  });
  await shutdownPromise;
}

export function buildLangfuseTags(tags: Array<string | undefined>): string[] {
  const unique = new Set<string>();
  for (const tag of tags) {
    const normalized = tag?.trim();
    if (normalized) {
      unique.add(normalized);
    }
  }
  return [...unique];
}

export { getActiveTraceId, propagateAttributes, startActiveObservation, startObservation };
export type { LangfuseAgent, LangfuseGeneration, LangfuseObservation, LangfuseTool };
