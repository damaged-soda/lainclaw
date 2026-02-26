import { type CoreToolsPort } from "../contracts.js";

export type CoreToolsAdapter = CoreToolsPort;

export interface ToolsAdapterOptions {
  implementation?: CoreToolsPort;
}

export function createToolsAdapter(options: ToolsAdapterOptions = {}): CoreToolsAdapter {
  if (!options.implementation) {
    throw new Error("CoreToolsAdapter implementation is required");
  }
  return options.implementation;
}
