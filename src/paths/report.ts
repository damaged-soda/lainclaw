import { PATH_DEFS, type PathKey } from "./definitions.js";
import { resolveLainclawHome, resolvePaths, resolveRuntimePaths, type ResolvedPaths } from "./runtime.js";
import type { AgentPathOp, PathKind, PathVisibility } from "./contracts.js";

export interface PathReportEntry {
  key: PathKey;
  path: string;
  kind: PathKind;
  visibility: PathVisibility;
  ops: AgentPathOp[];
  purpose: string;
}

type VisibilityFilter = "all" | PathVisibility;

function matchesVisibility(visibility: PathVisibility, filter: VisibilityFilter): boolean {
  return filter === "all" || filter === visibility;
}

export function getPathReportEntries(
  paths: ResolvedPaths = resolveRuntimePaths(),
  options: { visibility?: VisibilityFilter } = {},
): PathReportEntry[] {
  const visibility = options.visibility ?? "all";
  return (Object.keys(PATH_DEFS) as PathKey[])
    .filter((key) => matchesVisibility(PATH_DEFS[key].visibility, visibility))
    .map((key) => ({
      key,
      path: paths[key],
      kind: PATH_DEFS[key].kind,
      visibility: PATH_DEFS[key].visibility,
      ops: [...PATH_DEFS[key].ops],
      purpose: PATH_DEFS[key].purpose,
    }));
}

export function getPathReportEntry(
  key: string,
  paths: ResolvedPaths = resolveRuntimePaths(),
  options: { visibility?: VisibilityFilter } = {},
): PathReportEntry | undefined {
  const normalizedKey = key.trim() as PathKey;
  if (!Object.hasOwn(PATH_DEFS, normalizedKey)) {
    return undefined;
  }

  const definition = PATH_DEFS[normalizedKey];
  const visibility = options.visibility ?? "all";
  if (!matchesVisibility(definition.visibility, visibility)) {
    return undefined;
  }

  return {
    key: normalizedKey,
    path: paths[normalizedKey],
    kind: definition.kind,
    visibility: definition.visibility,
    ops: [...definition.ops],
    purpose: definition.purpose,
  };
}

export function buildRuntimePathsPromptSummary(env: NodeJS.ProcessEnv = process.env): string {
  const home = resolveLainclawHome(env);
  const paths = resolvePaths(home);
  const visibleEntries = getPathReportEntries(paths, { visibility: "visible" });

  const lines = [
    "## Runtime Paths",
    `- LAINCLAW_HOME: ${home}`,
    `- workspace: ${paths.workspace}`,
  ];

  if (visibleEntries.length > 0) {
    lines.push("- 可见系统路径：");
    for (const entry of visibleEntries) {
      lines.push(`  - ${entry.key}: ${entry.path}`);
      lines.push(`    purpose: ${entry.purpose}`);
      lines.push(`    ops: ${entry.ops.join(", ") || "(none)"}`);
    }
  }

  lines.push("- 如需继续探索 workspace 内容，使用 list_dir / glob / read。");
  lines.push("- 如需了解某个可见系统路径的用途，使用 path_describe。");

  return lines.join("\n");
}

export function buildPathsShowReport(env: NodeJS.ProcessEnv = process.env): {
  lainclawHome: string;
  workspace: string;
  visiblePathKeys: PathKey[];
  paths: Array<PathReportEntry & {
    agentVisible: boolean;
    defaultAgentOps: AgentPathOp[];
  }>;
} {
  const home = resolveLainclawHome(env);
  const paths = resolvePaths(home);
  const entries = getPathReportEntries(paths);

  return {
    lainclawHome: home,
    workspace: paths.workspace,
    visiblePathKeys: entries
      .filter((entry) => entry.visibility === "visible")
      .map((entry) => entry.key),
    paths: entries.map((entry) => ({
      ...entry,
      agentVisible: entry.visibility === "visible",
      defaultAgentOps: [...entry.ops],
    })),
  };
}
