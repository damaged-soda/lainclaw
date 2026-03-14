import {
  appendSessionMemory,
  getAllSessionTranscriptMessages,
  updateSessionRecord,
} from "./sessionStore.js";

export interface SessionMemoryCompactionInput {
  sessionKey: string;
  sessionId: string;
  memoryEnabled: boolean;
  compactedMessageCount: number;
}

export interface SessionMemoryCompactor {
  compactIfNeeded(input: SessionMemoryCompactionInput): Promise<boolean>;
}

export function createSessionMemoryCompactor(): SessionMemoryCompactor {
  return {
    async compactIfNeeded(input: SessionMemoryCompactionInput): Promise<boolean> {
      if (!input.memoryEnabled) {
        return false;
      }

      const allMessages = await getAllSessionTranscriptMessages(input.sessionId);
      if (allMessages.length <= 24) {
        return false;
      }

      const summaryLines = allMessages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .slice(-16)
        .map((message) => message.content)
        .filter((line) => line.length > 0)
        .map((line, index) => `${index + 1}. ${line}`);

      if (summaryLines.length < 6) {
        return false;
      }

      const summary = `## Memory Summary\n${summaryLines.map((line) => `- ${line}`).join("\n")}`;
      await appendSessionMemory(input.sessionKey, input.sessionId, summary);
      const cutoff = Math.max(allMessages.length - 12, 0);
      await updateSessionRecord(input.sessionKey, { compactedMessageCount: cutoff });
      return true;
    },
  };
}

export const sessionMemoryCompactor = createSessionMemoryCompactor();
