import { createCoreCoordinator } from "../core/index.js";
import { createRuntimeAdapter } from "../runtime/adapter.js";
import { createSessionAdapter } from "../sessions/adapter.js";
import { createToolsAdapter } from "../tools/adapter.js";

export const agentCoordinator = createCoreCoordinator({
  sessionAdapter: createSessionAdapter(),
  toolsAdapter: createToolsAdapter(),
  runtimeAdapter: createRuntimeAdapter(),
});
