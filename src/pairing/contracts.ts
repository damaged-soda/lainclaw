export const DEFAULT_PAIRING_PENDING_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_PAIRING_PENDING_MAX = 3;

export type PairingChannel = string;
export type PairingPolicy = "open" | "allowlist" | "pairing" | "disabled";

export type PairingStoreLimits = {
  ttlMs?: number;
  maxPending?: number;
};

export interface PairingRequest {
  id: string;
  code: string;
  createdAt: string;
  lastSeenAt: string;
  meta?: Record<string, string>;
}
