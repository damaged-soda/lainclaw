import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from "@mariozechner/pi-agent-core";
import type { Message, Model } from "@mariozechner/pi-ai";
import { writeDebugLogIfEnabled } from "../shared/debug.js";
import {
  agentStateStore,
  normalizePersistedMessages,
  type AgentStateSnapshot,
  type AgentStateStore,
} from "./agentStateStore.js";

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
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  sessionId?: string;
}

export interface SessionAgentAccessOptions {
  sessionKey: string;
  sessionId: string;
  provider: string;
  profileId: string;
  systemPrompt: string;
  model: Model<any>;
  tools: AgentTool<any>[];
  initialMessages: Message[];
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  debug?: boolean;
}

export interface SessionAgentRunContext {
  source: "memory" | "snapshot" | "new";
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
}

function createDefaultAgent(input: SessionAgentFactoryInput): SessionManagedAgent {
  return new Agent({
    initialState: input.initialState,
    convertToLlm: input.convertToLlm,
    getApiKey: input.getApiKey,
    sessionId: input.sessionId,
  }) as unknown as SessionManagedAgent;
}

function nowIso(): string {
  return new Date().toISOString();
}

function matchesRecord(record: SessionAgentRecord, options: SessionAgentAccessOptions): boolean {
  return (
    record.sessionId === options.sessionId &&
    record.provider === options.provider &&
    record.profileId === options.profileId
  );
}

function matchesSnapshot(snapshot: AgentStateSnapshot, options: SessionAgentAccessOptions): boolean {
  return (
    snapshot.sessionId === options.sessionId &&
    snapshot.provider === options.provider &&
    snapshot.profileId === options.profileId
  );
}

function createSnapshot(
  options: SessionAgentAccessOptions,
  agent: SessionManagedAgent,
): AgentStateSnapshot {
  return {
    version: 1,
    sessionKey: options.sessionKey,
    sessionId: options.sessionId,
    provider: options.provider,
    profileId: options.profileId,
    systemPrompt: agent.state.systemPrompt || options.systemPrompt,
    messages: normalizePersistedMessages(agent.state.messages),
    updatedAt: nowIso(),
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
    const cached = agents.get(access.sessionKey);
    if (cached && matchesRecord(cached, access)) {
      return { agent: cached.agent, source: "memory" };
    }

    const snapshot = await stateStore.load(access.sessionKey);
    const canRestoreFromSnapshot = Boolean(snapshot && matchesSnapshot(snapshot, access));
    const restoredMessages = canRestoreFromSnapshot ? snapshot?.messages ?? [] : access.initialMessages;
    const restoredPrompt = canRestoreFromSnapshot
      ? snapshot?.systemPrompt || access.systemPrompt
      : access.systemPrompt;
    const agent = agentFactory({
      initialState: {
        systemPrompt: restoredPrompt,
        model: access.model,
        messages: restoredMessages,
        tools: access.tools,
      },
      convertToLlm: access.convertToLlm,
      getApiKey: access.getApiKey,
      sessionId: access.sessionId,
    });

    agents.set(access.sessionKey, {
      sessionId: access.sessionId,
      provider: access.provider,
      profileId: access.profileId,
      agent,
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
      return withSessionLock(access.sessionKey, async () => {
        const { agent, source } = await getOrCreateAgent(access);
        agent.sessionId = access.sessionId;
        agent.setModel(access.model);
        agent.setSystemPrompt(access.systemPrompt);
        agent.setTools(access.tools);

        writeDebugLogIfEnabled(access.debug, "runtime.agent.session.bound", {
          sessionKey: access.sessionKey,
          sessionId: access.sessionId,
          provider: access.provider,
          profileId: access.profileId,
          source,
          initialMessageCount: access.initialMessages.length,
          agentMessageCount: normalizePersistedMessages(agent.state.messages).length,
        });

        try {
          const result = await fn(agent, { source });
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
