import { createCoreCoordinator } from "../core/index.js";
import { createRuntimeAdapter } from "../runtime/adapter.js";
import { createSessionAdapter } from "../sessions/adapter.js";
import { createToolsAdapter } from "../tools/adapter.js";

export const coreCoordinator = createCoreCoordinator({
  sessionAdapter: createSessionAdapter(),
  toolsAdapter: createToolsAdapter(),
  runtimeAdapter: createRuntimeAdapter(),
});

export const runAgent = coreCoordinator.runAgent;
export { createCoreCoordinator, type CoreCoordinator as CoreCoordinatorExport } from "../core/index.js";
export type { CoreRunAgentOptions } from "../core/contracts.js";
