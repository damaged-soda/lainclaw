import { type CoreSessionPort } from "../contracts.js";

export type CoreSessionAdapter = CoreSessionPort;

export interface SessionAdapterOptions {
  implementation?: CoreSessionPort;
}

export function createSessionAdapter(options: SessionAdapterOptions = {}): CoreSessionAdapter {
  if (!options.implementation) {
    throw new Error("CoreSessionAdapter implementation is required");
  }
  return options.implementation;
}
