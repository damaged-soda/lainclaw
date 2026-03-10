import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from "@mariozechner/pi-agent-core";
import type { Message, Model } from "@mariozechner/pi-ai";
import { writeDebugLogIfEnabled } from "../shared/debug.js";
import type { RequestContext, RuntimeContinueReason, RuntimeRunMode } from "../shared/types.js";
import {
  agentStateStore,
  normalizePersistedMessages,
  type AgentStateSnapshot,
  type AgentStateStore,
} from "./agentStateStore.js";
import { transformContextMessages } from "./context.js";

export interface SessionManagedAgent {
  readonly state: {
    systemPrompt: string;
    messages: unknown[];
  };
  sessionId?: string;
  setSystemPrompt(value: string): void;
  setModel(model: Model<any>): void;
  setTools(tools: AgentTool<any>[]): void;
  prompt(message: Message): Promise<void>;
  continue(): Promise<void>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
}

export interface SessionAgentFactoryInput {
  initialState: {
    systemPrompt: string;
    model: Model<any>;
    messages: Message[];
    tools: AgentTool<any>[];
  };
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  sessionId?: string;
}

export interface SessionAgentAccessOptions {
  requestContext: RequestContext;
  systemPrompt: string;
  model: Model<any>;
  tools: AgentTool<any>[];
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  debug?: boolean;
}

export interface SessionAgentRunContext {
  source: "memory" | "snapshot" | "new";
  runMode: RuntimeRunMode;
  continueReason?: RuntimeContinueReason;
  lastMessageRole?: Message["role"];
}

export interface SessionAgentManager {
  runWithSessionAgent<T>(
    options: SessionAgentAccessOptions,
    fn: (agent: SessionManagedAgent, context: SessionAgentRunContext) => Promise<T>,
  ): Promise<T>;
}

export interface CreateSessionAgentManagerOptions {
  stateStore?: AgentStateStore;
  agentFactory?: (input: SessionAgentFactoryInput) => SessionManagedAgent;
}

interface SessionAgentRecord {
  sessionId: string;
  provider: string;
  profileId: string;
  agent: SessionManagedAgent;
  requestContext: RequestContext;
}

function createDefaultAgent(input: SessionAgentFactoryInput): SessionManagedAgent {
  return new Agent({
    initialState: input.initialState,
    convertToLlm: input.convertToLlm,
    transformContext: input.transformContext,
    getApiKey: input.getApiKey,
    sessionId: input.sessionId,
  }) as unknown as SessionManagedAgent;
}

function nowIso(): string {
  return new Date().toISOString();
}

function matchesRecord(record: SessionAgentRecord, options: SessionAgentAccessOptions): boolean {
  return (
    record.sessionId === options.requestContext.sessionId &&
    record.provider === options.requestContext.provider &&
    record.profileId === options.requestContext.profileId
  );
}

function matchesSnapshot(snapshot: AgentStateSnapshot, options: SessionAgentAccessOptions): boolean {
  return (
    snapshot.sessionId === options.requestContext.sessionId &&
    snapshot.provider === options.requestContext.provider &&
    snapshot.profileId === options.requestContext.profileId
  );
}

function createSnapshot(
  options: SessionAgentAccessOptions,
  agent: SessionManagedAgent,
): AgentStateSnapshot {
  return {
    version: 2,
    sessionKey: options.requestContext.sessionKey,
    sessionId: options.requestContext.sessionId,
    provider: options.requestContext.provider,
    profileId: options.requestContext.profileId,
    systemPrompt: agent.state.systemPrompt || options.systemPrompt,
    messages: normalizePersistedMessages(agent.state.messages),
    updatedAt: nowIso(),
  };
}

function syncRequestContext(
  target: RequestContext,
  source: RequestContext,
): void {
  Object.assign(target, {
    requestId: source.requestId,
    createdAt: source.createdAt,
    input: source.input,
    sessionKey: source.sessionKey,
    sessionId: source.sessionId,
    bootstrapMessages: source.bootstrapMessages,
    memorySnippet: source.memorySnippet,
    contextMessageLimit: source.contextMessageLimit,
    systemPrompt: source.systemPrompt,
    tools: source.tools,
    provider: source.provider,
    profileId: source.profileId,
    runMode: source.runMode,
    continueReason: source.continueReason,
    memoryEnabled: source.memoryEnabled,
    debug: source.debug,
  });
}

function resolveLastMessageRole(agent: SessionManagedAgent): Message["role"] | undefined {
  const messages = normalizePersistedMessages(agent.state.messages);
  const lastMessage = messages[messages.length - 1];
  return lastMessage?.role;
}

function resolveContinueReason(
  requestContext: RequestContext,
  source: SessionAgentRunContext["source"],
  lastMessageRole: Message["role"] | undefined,
): RuntimeContinueReason {
  if (requestContext.continueReason) {
    return requestContext.continueReason;
  }
  if (source === "snapshot") {
    return "restore_resume";
  }
  if (lastMessageRole === "toolResult") {
    return "tool_result";
  }
  return "retry";
}

function resolveRunContext(
  access: SessionAgentAccessOptions,
  agent: SessionManagedAgent,
  source: SessionAgentRunContext["source"],
): SessionAgentRunContext {
  const lastMessageRole = resolveLastMessageRole(agent);
  const normalizedInput = access.requestContext.input.trim();

  if (normalizedInput.length > 0) {
    return {
      source,
      runMode: "prompt",
      lastMessageRole,
    };
  }

  if (access.requestContext.runMode !== "continue") {
    throw new Error("Cannot run without user input. Use continue mode to resume the agent.");
  }

  if (!lastMessageRole) {
    throw new Error("Cannot continue without existing agent state.");
  }

  if (lastMessageRole === "assistant") {
    throw new Error("Cannot continue from last message role: assistant");
  }

  return {
    source,
    runMode: "continue",
    continueReason: resolveContinueReason(access.requestContext, source, lastMessageRole),
    lastMessageRole,
  };
}

export function createSessionAgentManager(
  options: CreateSessionAgentManagerOptions = {},
): SessionAgentManager {
  const stateStore = options.stateStore ?? agentStateStore;
  const agentFactory = options.agentFactory ?? createDefaultAgent;
  const agents = new Map<string, SessionAgentRecord>();
  const queues = new Map<string, Promise<void>>();

  async function withSessionLock<T>(sessionKey: string, fn: () => Promise<T>): Promise<T> {
    const previous = queues.get(sessionKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entry = previous.catch(() => undefined).then(() => current);
    queues.set(sessionKey, entry);
    await previous.catch(() => undefined);

    try {
      return await fn();
    } finally {
      release();
      if (queues.get(sessionKey) === entry) {
        queues.delete(sessionKey);
      }
    }
  }

  async function getOrCreateAgent(
    access: SessionAgentAccessOptions,
  ): Promise<{ agent: SessionManagedAgent; source: SessionAgentRunContext["source"] }> {
    const cached = agents.get(access.requestContext.sessionKey);
    if (cached && matchesRecord(cached, access)) {
      syncRequestContext(cached.requestContext, access.requestContext);
      return { agent: cached.agent, source: "memory" };
    }

    const snapshot = await stateStore.load(access.requestContext.sessionKey);
    const canRestoreFromSnapshot = Boolean(snapshot && matchesSnapshot(snapshot, access));
    const restoredMessages = canRestoreFromSnapshot
      ? normalizePersistedMessages(snapshot?.messages)
      : access.requestContext.bootstrapMessages ?? [];
    const restoredPrompt = canRestoreFromSnapshot
      ? snapshot?.systemPrompt || access.systemPrompt
      : access.systemPrompt;
    const currentRequestContext = {
      ...access.requestContext,
    };
    const agent = agentFactory({
      initialState: {
        systemPrompt: restoredPrompt,
        model: access.model,
        messages: restoredMessages,
        tools: access.tools,
      },
      convertToLlm: access.convertToLlm,
      transformContext: async (messages: AgentMessage[], signal?: AbortSignal) => {
        return transformContextMessages({
          requestContext: currentRequestContext,
          messages,
        });
      },
      getApiKey: access.getApiKey,
      sessionId: access.requestContext.sessionId,
    });

    agents.set(access.requestContext.sessionKey, {
      sessionId: access.requestContext.sessionId,
      provider: access.requestContext.provider,
      profileId: access.requestContext.profileId,
      agent,
      requestContext: currentRequestContext,
    });

    return {
      agent,
      source: canRestoreFromSnapshot ? "snapshot" : "new",
    };
  }

  return {
    runWithSessionAgent: async <T>(
      access: SessionAgentAccessOptions,
      fn: (agent: SessionManagedAgent, context: SessionAgentRunContext) => Promise<T>,
    ): Promise<T> => {
      return withSessionLock(access.requestContext.sessionKey, async () => {
        const { agent, source } = await getOrCreateAgent(access);
        const record = agents.get(access.requestContext.sessionKey);
        if (record) {
          syncRequestContext(record.requestContext, access.requestContext);
        }

        agent.sessionId = access.requestContext.sessionId;
        agent.setModel(access.model);
        agent.setSystemPrompt(access.systemPrompt);
        agent.setTools(access.tools);
        const runContext = resolveRunContext(access, agent, source);

        writeDebugLogIfEnabled(access.debug, "runtime.agent.session.bound", {
          sessionKey: access.requestContext.sessionKey,
          sessionId: access.requestContext.sessionId,
          provider: access.requestContext.provider,
          profileId: access.requestContext.profileId,
          source,
          requestedRunMode: access.requestContext.runMode,
          resolvedRunMode: runContext.runMode,
          continueReason: runContext.continueReason,
          lastMessageRole: runContext.lastMessageRole,
          bootstrapMessageCount: access.requestContext.bootstrapMessages?.length ?? 0,
          agentMessageCount: normalizePersistedMessages(agent.state.messages).length,
        });

        try {
          const result = await fn(agent, runContext);
          await stateStore.save(createSnapshot(access, agent));
          return result;
        } catch (error) {
          await stateStore.save(createSnapshot(access, agent));
          throw error;
        }
      });
    },
  };
}

export const sessionAgentManager = createSessionAgentManager();
