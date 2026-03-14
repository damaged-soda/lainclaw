import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from "@mariozechner/pi-agent-core";
import type { Message, Model } from "@mariozechner/pi-ai";
import { writeDebugLogIfEnabled } from "../shared/debug.js";
import type { RequestContext } from "../shared/types.js";
import { normalizePersistedMessages } from "../sessions/agentSnapshotStore.js";
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

export interface SessionAgentRunInput {
  requestContext: RequestContext;
  systemPrompt: string;
  initialState: {
    source: "snapshot" | "transcript" | "new";
    systemPrompt: string;
    messages: Message[];
  };
  model: Model<any>;
  tools: AgentTool<any>[];
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  debug?: boolean;
}

export interface SessionAgentRunContext {
  cache: "hit" | "miss";
}

export interface SessionAgentRunResult<T> {
  value: T;
  cache: SessionAgentRunContext["cache"];
  sessionState: {
    systemPrompt: string;
    messages: Message[];
  };
}

export interface SessionAgentManager {
  run<T>(
    input: SessionAgentRunInput,
    fn: (agent: SessionManagedAgent, context: SessionAgentRunContext) => Promise<T>,
  ): Promise<SessionAgentRunResult<T>>;
}

export interface CreateSessionAgentManagerOptions {
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

function matchesRecord(record: SessionAgentRecord, options: SessionAgentRunInput): boolean {
  return (
    record.sessionId === options.requestContext.sessionId &&
    record.provider === options.requestContext.provider &&
    record.profileId === options.requestContext.profileId
  );
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

export function createSessionAgentManager(
  options: CreateSessionAgentManagerOptions = {},
): SessionAgentManager {
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
    access: SessionAgentRunInput,
  ): Promise<{ agent: SessionManagedAgent; cache: SessionAgentRunContext["cache"] }> {
    const cached = agents.get(access.requestContext.sessionKey);
    if (cached && matchesRecord(cached, access)) {
      syncRequestContext(cached.requestContext, access.requestContext);
      return { agent: cached.agent, cache: "hit" };
    }

    const currentRequestContext = {
      ...access.requestContext,
    };
    const agent = agentFactory({
      initialState: {
        systemPrompt: access.initialState.systemPrompt,
        model: access.model,
        messages: access.initialState.messages,
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
      cache: "miss",
    };
  }

  return {
    run: async <T>(
      access: SessionAgentRunInput,
      fn: (agent: SessionManagedAgent, context: SessionAgentRunContext) => Promise<T>,
    ): Promise<SessionAgentRunResult<T>> => {
      return withSessionLock(access.requestContext.sessionKey, async () => {
        const { agent, cache } = await getOrCreateAgent(access);
        const record = agents.get(access.requestContext.sessionKey);
        if (record) {
          syncRequestContext(record.requestContext, access.requestContext);
        }

        agent.sessionId = access.requestContext.sessionId;
        agent.setModel(access.model);
        agent.setSystemPrompt(access.systemPrompt);
        agent.setTools(access.tools);

        writeDebugLogIfEnabled(access.debug, "runtime.agent.session.bound", {
          sessionKey: access.requestContext.sessionKey,
          sessionId: access.requestContext.sessionId,
          provider: access.requestContext.provider,
          profileId: access.requestContext.profileId,
          cache,
          initialStateSource: access.initialState.source,
          requestedRunMode: access.requestContext.runMode,
          bootstrapMessageCount: access.requestContext.bootstrapMessages?.length ?? 0,
          agentMessageCount: normalizePersistedMessages(agent.state.messages).length,
        });

        const value = await fn(agent, { cache });
        return {
          value,
          cache,
          sessionState: {
            systemPrompt: agent.state.systemPrompt || access.systemPrompt,
            messages: normalizePersistedMessages(agent.state.messages),
          },
        };
      });
    },
  };
}

export const sessionAgentManager = createSessionAgentManager();
