import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SkillSource = "builtin" | "workspace";

export interface SkillEntry {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: SkillSource;
}

export interface LoadSkillsOptions {
  cwd: string;
  builtinSkillsDir?: string;
  workspaceSkillsDir?: string;
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_SKILLS_DIR = path.resolve(MODULE_DIR, "../../skills");

function normalizeSkillName(raw: string): string {
  return raw.trim().toLowerCase();
}

function escapeXml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function trimText(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function parseFrontmatterValue(
  lines: string[],
  startIndex: number,
): { key: string; value: string; nextIndex: number } | undefined {
  const line = lines[startIndex];
  const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
  if (!match) {
    return undefined;
  }

  const key = match[1];
  const inlineValue = match[2] ?? "";
  if (!["|", "|-", ">", ">-"].includes(inlineValue.trim())) {
    return {
      key,
      value: inlineValue.trim(),
      nextIndex: startIndex + 1,
    };
  }

  const blockLines: string[] = [];
  let index = startIndex + 1;
  while (index < lines.length) {
    const candidate = lines[index];
    if (!candidate.startsWith("  ")) {
      break;
    }
    blockLines.push(candidate.trim());
    index += 1;
  }

  return {
    key,
    value: blockLines.join(" ").trim(),
    nextIndex: index,
  };
}

function parseFrontmatter(rawContent: string): Record<string, string> {
  if (!rawContent.startsWith("---\n")) {
    return {};
  }

  const endIndex = rawContent.indexOf("\n---\n", 4);
  if (endIndex < 0) {
    return {};
  }

  const block = rawContent.slice(4, endIndex);
  const lines = block.split("\n");
  const values: Record<string, string> = {};
  let index = 0;
  while (index < lines.length) {
    const parsed = parseFrontmatterValue(lines, index);
    if (!parsed) {
      index += 1;
      continue;
    }
    values[parsed.key] = parsed.value;
    index = parsed.nextIndex;
  }

  return values;
}

async function loadSkillsFromDir(rootDir: string, source: SkillSource): Promise<SkillEntry[]> {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    const skills: SkillEntry[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const baseDir = path.join(rootDir, entry.name);
      const filePath = path.join(baseDir, "SKILL.md");
      let rawContent = "";
      try {
        rawContent = await fs.readFile(filePath, "utf8");
      } catch {
        continue;
      }

      const frontmatter = parseFrontmatter(rawContent);
      const name = trimText(frontmatter.name) ?? entry.name;
      const description = trimText(frontmatter.description) ?? name;
      skills.push({
        name,
        description,
        filePath,
        baseDir,
        source,
      });
    }

    return skills.sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

export function resolveBuiltinSkillsDir(): string {
  return BUILTIN_SKILLS_DIR;
}

export async function loadSkills(options: LoadSkillsOptions): Promise<SkillEntry[]> {
  const cwd = path.resolve(options.cwd);
  const builtinSkillsDir = options.builtinSkillsDir
    ? path.resolve(options.builtinSkillsDir)
    : resolveBuiltinSkillsDir();
  const workspaceSkillsDir = options.workspaceSkillsDir
    ? path.resolve(options.workspaceSkillsDir)
    : path.join(cwd, "skills");

  const [builtinSkills, workspaceSkills] = await Promise.all([
    loadSkillsFromDir(builtinSkillsDir, "builtin"),
    loadSkillsFromDir(workspaceSkillsDir, "workspace"),
  ]);

  const merged = new Map<string, SkillEntry>();
  for (const skill of builtinSkills) {
    merged.set(normalizeSkillName(skill.name), skill);
  }
  for (const skill of workspaceSkills) {
    merged.set(normalizeSkillName(skill.name), skill);
  }

  return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export function buildSkillsPrompt(skills: SkillEntry[]): string {
  if (skills.length === 0) {
    return "";
  }

  const lines = ["<available_skills>"];
  for (const skill of skills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}

export async function buildSkillsPromptForCwd(options: LoadSkillsOptions): Promise<string> {
  const skills = await loadSkills(options);
  return buildSkillsPrompt(skills);
}
