import path from "node:path";
import { getModel } from "@mariozechner/pi-ai";
import { getOpenAICodexApiContext, OPENAI_CODEX_MODEL } from "../auth/authManager.js";
import {
  sessionAgentManager as defaultSessionAgentManager,
  type SessionAgentManager,
} from "../runtime/sessionAgentManager.js";
import { writeDebugLogIfEnabled } from "../shared/debug.js";
import { resolveBooleanFlag } from "../shared/envFlags.js";
import { executeTool } from "../tools/executor.js";
import type { ProviderResult, ProviderRunInput } from "./registry.js";
import { isLangfuseTracingReady } from "../observability/langfuse.js";
import { createCodexAgentEventAccumulator } from "./codex/agentEventAccumulator.js";
import { toText } from "./codex/messageText.js";
import { runCodexSession } from "./codex/sessionRun.js";
import { BASE_SYSTEM_PROMPT } from "../prompt/systemPrompt.js";
import { createCodexToolRuntime } from "./codex/toolRuntime.js";

function isAbortError(error: unknown): error is Error {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function getAdapterStage(route: string, profileId: string, hasFailure: boolean): string {
  return `${route}.${profileId}${hasFailure ? ".failed" : ""}`;
}

function shouldPrefixResponse(profileId: string, provider: string): string {
  if (!resolveBooleanFlag(process.env.LAINCLAW_CODEX_PREFIX_RESPONSE)) {
    return "";
  }
  return `[${provider}:${profileId}] `;
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveEmptyResponseText(input: {
  toolErrorMessage?: string;
  assistantErrorMessage?: string;
  runErrorMessage?: string;
  stopReason?: string;
}): { text: string; source: "tool_error" | "assistant_error" | "runtime_error" | "stop_reason" | "empty_response" } {
  if (hasText(input.toolErrorMessage)) {
    return {
      text: input.toolErrorMessage,
      source: "tool_error",
    };
  }

  if (hasText(input.assistantErrorMessage)) {
    return {
      text: input.assistantErrorMessage,
      source: "assistant_error",
    };
  }

  if (hasText(input.runErrorMessage)) {
    return {
      text: input.runErrorMessage,
      source: "runtime_error",
    };
  }

  if (hasText(input.stopReason)) {
    return {
      text: `Model stopped with stopReason=${input.stopReason} before returning a text response.`,
      source: "stop_reason",
    };
  }

  return {
    text: "Model finished without returning a text response.",
    source: "empty_response",
  };
}

function normalizeProvider(raw: string): string {
  const normalized = (raw || "").trim();
  if (!normalized) {
    throw new Error("Missing provider. Set --provider in command args or runtime config.");
  }
  return normalized;
}

interface CodexAdapterDependencies {
  sessionAgentManager?: SessionAgentManager;
  executeToolFn?: typeof executeTool;
  getApiContextFn?: typeof getOpenAICodexApiContext;
  getModelFn?: typeof getModel;
}

export function createRunCodexAdapter(
  dependencies: CodexAdapterDependencies = {},
): (input: ProviderRunInput) => Promise<ProviderResult> {
  const sessionAgentManager = dependencies.sessionAgentManager ?? defaultSessionAgentManager;
  const executeToolFn = dependencies.executeToolFn ?? executeTool;
  const getApiContextFn = dependencies.getApiContextFn ?? getOpenAICodexApiContext;
  const getModelFn = dependencies.getModelFn ?? getModel;

  return async function runCodexAdapter(input: ProviderRunInput): Promise<ProviderResult> {
    const requestContext = input.requestContext;
    const provider = normalizeProvider(requestContext.provider);
    if (provider !== "openai-codex") {
      throw new Error(`Unsupported provider for openai runtime: ${provider}`);
    }
    const route = `adapter.${provider}`;
    const requestId = requestContext.requestId;
    const cwd = path.resolve(input.cwd || process.cwd());
    const tracingEnabled = isLangfuseTracingReady();

    const toolRuntime = createCodexToolRuntime(
      {
        requestId,
        requestContext,
        provider,
        cwd,
        toolSpecs: input.toolSpecs,
        withTools: input.withTools,
        tracingEnabled,
      },
      {
        executeToolFn,
      },
    );
    const eventState = createCodexAgentEventAccumulator({
      provider,
      canonicalByCodexName: toolRuntime.toolNameMap.canonicalByCodex,
    });

    const { apiKey, profile } = await getApiContextFn(requestContext.profileId);
    const model = getModelFn(provider, OPENAI_CODEX_MODEL);
    if (!model) {
      throw new Error(`No model found: ${provider}/${OPENAI_CODEX_MODEL}`);
    }

    const profileId = profile.id;
    const systemPrompt = requestContext.systemPrompt ?? BASE_SYSTEM_PROMPT;

    writeDebugLogIfEnabled(requestContext.debug, "provider.codex.system_prompt_attached", {
      requestId,
      sessionKey: requestContext.sessionKey,
      provider,
      profileId,
      source: requestContext.systemPrompt ? "request_context" : "default",
      systemPrompt,
    });

    const sessionRun = await runCodexSession({
      sessionAgentManager,
      requestContext,
      preparedState: input.preparedState,
      systemPrompt,
      model,
      agentTools: toolRuntime.agentTools,
      toolSpecs: toolRuntime.toolSpecs,
      provider,
      profileId,
      route,
      modelName: OPENAI_CODEX_MODEL,
      withTools: input.withTools,
      tracingEnabled,
      apiKey,
      eventState,
      ...(input.onAgentEvent ? { onAgentEvent: input.onAgentEvent } : {}),
    });

    writeDebugLogIfEnabled(requestContext.debug, "provider.codex.agent_session_used", {
      requestId,
      sessionKey: requestContext.sessionKey,
      sessionId: requestContext.sessionId,
      provider,
      profileId,
      source: sessionRun.agentSource,
    });

    const primaryToolError = eventState.toolError;
    if (sessionRun.runErr && !primaryToolError && !isAbortError(sessionRun.runErr)) {
      throw sessionRun.runErr;
    }

    const failed = Boolean(sessionRun.runErr);
    const resolvedFinalMessage = eventState.finalMessage;
    const responsePrefix = shouldPrefixResponse(profile.id, provider);
    const responseText = toText(resolvedFinalMessage);
    const stopReason = eventState.stopReason;
    const adapterFailed = failed || stopReason === "error";
    const resolvedToolCalls = eventState.toolCalls;
    const resolvedToolResults = eventState.toolResults;
    const assistantErrorMessage =
      resolvedFinalMessage
      && typeof resolvedFinalMessage === "object"
      && "errorMessage" in resolvedFinalMessage
      && hasText((resolvedFinalMessage as { errorMessage?: string }).errorMessage)
        ? (resolvedFinalMessage as { errorMessage: string }).errorMessage
        : undefined;
    const fallbackResponse = hasText(responseText)
      ? undefined
      : resolveEmptyResponseText({
        toolErrorMessage: primaryToolError?.message,
        assistantErrorMessage,
        runErrorMessage: sessionRun.runErr?.message,
        stopReason,
      });
    const resolvedResponseText = hasText(responseText) ? responseText : fallbackResponse.text;

    if (!hasText(responseText)) {
      writeDebugLogIfEnabled(requestContext.debug, "provider.codex.empty_response_fallback", {
        requestId,
        sessionKey: requestContext.sessionKey,
        sessionId: requestContext.sessionId,
        provider,
        profileId,
        stopReason: stopReason ?? "unknown",
        fallbackSource: fallbackResponse?.source ?? "unknown",
        hasRunError: failed,
        hasToolError: Boolean(primaryToolError),
        toolCallCount: resolvedToolCalls.length,
        toolResultCount: resolvedToolResults.length,
      });
    }

    return {
      route,
      stage: getAdapterStage(route, profileId, adapterFailed),
      result: `${responsePrefix}${resolvedResponseText}`,
      runMode: requestContext.runMode,
      ...(requestContext.continueReason ? { continueReason: requestContext.continueReason } : {}),
      toolCalls: resolvedToolCalls.length > 0 ? resolvedToolCalls : undefined,
      toolResults: resolvedToolResults.length > 0 ? resolvedToolResults : undefined,
      assistantMessage: resolvedFinalMessage,
      stopReason: failed ? "tool_error_or_runtime_error" : stopReason,
      provider,
      profileId,
      ...(sessionRun.sessionState ? { sessionState: sessionRun.sessionState } : {}),
    };
  };
}

export const runCodexAdapter = createRunCodexAdapter();
