import { type CoreRuntimePort } from "../contracts.js";

export type CoreRuntimeAdapter = CoreRuntimePort;

export interface RuntimeAdapterOptions {
  implementation?: CoreRuntimePort;
}

export function createRuntimeAdapter(options: RuntimeAdapterOptions = {}): CoreRuntimeAdapter {
  if (!options.implementation) {
    throw new Error("CoreRuntimeAdapter implementation is required");
  }
  return options.implementation;
}
