import { createCoreCoordinator } from "../core/index.js";
import { createRuntimeAdapter } from "../runtime/adapter.js";
import { createSessionAdapter } from "../sessions/adapter.js";
import { createToolsAdapter } from "../tools/adapter.js";

export const coreCoordinator = createCoreCoordinator({
  sessionAdapter: createSessionAdapter(),
  toolsAdapter: createToolsAdapter(),
  runtimeAdapter: createRuntimeAdapter(),
});

export type { CoreCoordinator, CoreRunAgentOptions } from "../core/contracts.js";
export { createCoreCoordinator } from "../core/index.js";
