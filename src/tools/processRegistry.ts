import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

const MAX_OUTPUT_CHARS = 200_000;
const MAX_PENDING_OUTPUT_CHARS = 30_000;
const FINISHED_SESSION_TTL_MS = 30 * 60 * 1000;

export type ProcessStatus = "running" | "completed" | "failed" | "killed";

export interface ProcessSession {
  id: string;
  sessionKey: string;
  command: string;
  cwd: string;
  startedAt: number;
  child: ChildProcessWithoutNullStreams;
  emitter: EventEmitter;
  aggregatedOutput: string;
  pendingStdout: string[];
  pendingStderr: string[];
  pendingStdoutChars: number;
  pendingStderrChars: number;
  totalOutputChars: number;
  truncated: boolean;
  backgrounded: boolean;
  status: ProcessStatus;
  exited: boolean;
  endedAt?: number;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | null;
}

export interface FinishedProcessSession {
  id: string;
  sessionKey: string;
  command: string;
  cwd: string;
  startedAt: number;
  endedAt: number;
  aggregatedOutput: string;
  pendingStdout: string;
  pendingStderr: string;
  truncated: boolean;
  totalOutputChars: number;
  status: ProcessStatus;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | null;
}

const runningSessions = new Map<string, ProcessSession>();
const finishedSessions = new Map<string, FinishedProcessSession>();

function trimWithCap(value: string, cap: number): string {
  if (value.length <= cap) {
    return value;
  }
  return value.slice(value.length - cap);
}

function sumChunks(chunks: string[]): number {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  return total;
}

function capChunks(chunks: string[], cap: number): { chunks: string[]; chars: number } {
  const nextChunks = [...chunks];
  let chars = sumChunks(nextChunks);
  if (chars <= cap) {
    return { chunks: nextChunks, chars };
  }

  while (nextChunks.length > 0 && chars - nextChunks[0].length >= cap) {
    chars -= nextChunks[0].length;
    nextChunks.shift();
  }

  if (nextChunks.length > 0 && chars > cap) {
    const overflow = chars - cap;
    nextChunks[0] = nextChunks[0].slice(overflow);
    chars = cap;
  }

  return { chunks: nextChunks, chars };
}

function purgeFinishedSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of finishedSessions.entries()) {
    if (now - session.endedAt > FINISHED_SESSION_TTL_MS) {
      finishedSessions.delete(sessionId);
    }
  }
}

export function createProcessSession(params: {
  sessionKey: string;
  command: string;
  cwd: string;
  child: ChildProcessWithoutNullStreams;
}): ProcessSession {
  purgeFinishedSessions();
  const session: ProcessSession = {
    id: randomUUID(),
    sessionKey: params.sessionKey,
    command: params.command,
    cwd: params.cwd,
    startedAt: Date.now(),
    child: params.child,
    emitter: new EventEmitter(),
    aggregatedOutput: "",
    pendingStdout: [],
    pendingStderr: [],
    pendingStdoutChars: 0,
    pendingStderrChars: 0,
    totalOutputChars: 0,
    truncated: false,
    backgrounded: false,
    status: "running",
    exited: false,
  };
  runningSessions.set(session.id, session);
  return session;
}

export function appendProcessOutput(
  session: ProcessSession,
  stream: "stdout" | "stderr",
  chunk: string,
): void {
  const normalizedChunk = chunk.toString();
  session.totalOutputChars += normalizedChunk.length;
  const aggregate = trimWithCap(session.aggregatedOutput + normalizedChunk, MAX_OUTPUT_CHARS);
  if (aggregate.length < session.aggregatedOutput.length + normalizedChunk.length) {
    session.truncated = true;
  }
  session.aggregatedOutput = aggregate;

  const existingChunks = stream === "stdout" ? session.pendingStdout : session.pendingStderr;
  const capped = capChunks([...existingChunks, normalizedChunk], MAX_PENDING_OUTPUT_CHARS);
  if (stream === "stdout") {
    session.pendingStdout = capped.chunks;
    session.pendingStdoutChars = capped.chars;
  } else {
    session.pendingStderr = capped.chunks;
    session.pendingStderrChars = capped.chars;
  }
  if (capped.chars < sumChunks([...existingChunks, normalizedChunk])) {
    session.truncated = true;
  }

  session.emitter.emit("update");
}

export function markProcessBackgrounded(session: ProcessSession): void {
  session.backgrounded = true;
}

export function finishProcessSession(
  session: ProcessSession,
  status: ProcessStatus,
  exitCode: number | null,
  exitSignal: NodeJS.Signals | null,
): void {
  session.status = status;
  session.exited = true;
  session.endedAt = Date.now();
  session.exitCode = exitCode;
  session.exitSignal = exitSignal;
  runningSessions.delete(session.id);

  if (session.backgrounded && session.endedAt) {
    const pending = drainProcessOutput(session);
    finishedSessions.set(session.id, {
      id: session.id,
      sessionKey: session.sessionKey,
      command: session.command,
      cwd: session.cwd,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      aggregatedOutput: session.aggregatedOutput,
      pendingStdout: pending.stdout,
      pendingStderr: pending.stderr,
      truncated: session.truncated,
      totalOutputChars: session.totalOutputChars,
      status,
      exitCode,
      exitSignal,
    });
  }

  session.emitter.emit("update");
  session.emitter.removeAllListeners();
}

export function drainProcessOutput(session: ProcessSession): { stdout: string; stderr: string } {
  const stdout = session.pendingStdout.join("");
  const stderr = session.pendingStderr.join("");
  session.pendingStdout = [];
  session.pendingStderr = [];
  session.pendingStdoutChars = 0;
  session.pendingStderrChars = 0;
  return { stdout, stderr };
}

export function waitForProcessUpdate(session: ProcessSession, timeoutMs: number): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || session.exited) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const handleUpdate = () => {
      clearTimeout(timer);
      session.emitter.off("update", handleUpdate);
      resolve();
    };
    const timer = setTimeout(() => {
      session.emitter.off("update", handleUpdate);
      resolve();
    }, timeoutMs);
    session.emitter.on("update", handleUpdate);
  });
}

export function getRunningProcessSession(sessionId: string): ProcessSession | undefined {
  purgeFinishedSessions();
  return runningSessions.get(sessionId);
}

export function getFinishedProcessSession(sessionId: string): FinishedProcessSession | undefined {
  purgeFinishedSessions();
  return finishedSessions.get(sessionId);
}

export function drainFinishedProcessOutput(session: FinishedProcessSession): { stdout: string; stderr: string } {
  const stdout = session.pendingStdout;
  const stderr = session.pendingStderr;
  session.pendingStdout = "";
  session.pendingStderr = "";
  return { stdout, stderr };
}

export function listProcessSessions(sessionKey: string): Array<
  | {
      id: string;
      status: ProcessStatus;
      command: string;
      cwd: string;
      startedAt: number;
      endedAt?: number;
      exitCode?: number | null;
      exitSignal?: NodeJS.Signals | null;
      truncated: boolean;
      totalOutputChars: number;
    }
> {
  purgeFinishedSessions();

  const running = Array.from(runningSessions.values())
    .filter((session) => session.sessionKey === sessionKey && session.backgrounded)
    .map((session) => ({
      id: session.id,
      status: session.status,
      command: session.command,
      cwd: session.cwd,
      startedAt: session.startedAt,
      exitCode: session.exitCode,
      exitSignal: session.exitSignal,
      truncated: session.truncated,
      totalOutputChars: session.totalOutputChars,
    }));

  const finished = Array.from(finishedSessions.values())
    .filter((session) => session.sessionKey === sessionKey)
    .map((session) => ({
      id: session.id,
      status: session.status,
      command: session.command,
      cwd: session.cwd,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      exitCode: session.exitCode,
      exitSignal: session.exitSignal,
      truncated: session.truncated,
      totalOutputChars: session.totalOutputChars,
    }));

  return [...running, ...finished].sort((left, right) => right.startedAt - left.startedAt);
}

export function removeFinishedProcessSession(sessionId: string): void {
  finishedSessions.delete(sessionId);
}
