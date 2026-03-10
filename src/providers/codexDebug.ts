import type { Message } from "@mariozechner/pi-ai";
import type { ContextToolSpec } from "../shared/types.js";

export interface CodexDebugRequestSnapshot {
  initialState: {
    systemPrompt: string;
    model: string;
    messages: Message[];
    tools?: ContextToolSpec[];
  };
  prompt: Message;
}

export function buildCodexDebugRequestSnapshot(params: {
  systemPrompt: string;
  modelName: string;
  messages: Message[];
  tools?: ContextToolSpec[];
  prompt: Message;
}): CodexDebugRequestSnapshot {
  return {
    initialState: {
      systemPrompt: params.systemPrompt,
      model: params.modelName,
      messages: params.messages,
      ...(Array.isArray(params.tools) && params.tools.length > 0 ? { tools: params.tools } : {}),
    },
    prompt: params.prompt,
  };
}
