import { getPathReportEntry, type AgentPathOp, type PathReportEntry } from "../../paths/index.js";

const DEFAULT_ROOT_KEY = "workspace";

export function resolveVisibleRootEntry(rawRoot: unknown, requiredOp?: AgentPathOp): PathReportEntry {
  const rootKey = typeof rawRoot === "string" && rawRoot.trim().length > 0 ? rawRoot.trim() : DEFAULT_ROOT_KEY;
  const entry = getPathReportEntry(rootKey, undefined, { visibility: "visible" });
  if (!entry) {
    throw new Error(`unknown visible root: ${rootKey}`);
  }
  if (requiredOp && !entry.ops.includes(requiredOp)) {
    throw new Error(`path root does not allow ${requiredOp}: ${rootKey}`);
  }
  return entry;
}
