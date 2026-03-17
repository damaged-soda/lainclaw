import fs from "node:fs/promises";
import path from "node:path";
import { resolveToolApplyPatchRoots } from "./allowedRoots.js";
import { resolveAllowedPath } from "./pathGuards.js";

const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";
const ADD_FILE_MARKER = "*** Add File: ";
const DELETE_FILE_MARKER = "*** Delete File: ";
const UPDATE_FILE_MARKER = "*** Update File: ";
const MOVE_TO_MARKER = "*** Move to: ";
const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT_MARKER = "@@ ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";

type AddFileHunk = {
  kind: "add";
  path: string;
  contents: string;
};

type DeleteFileHunk = {
  kind: "delete";
  path: string;
};

type UpdateFileChunk = {
  changeContext?: string;
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
};

type UpdateFileHunk = {
  kind: "update";
  path: string;
  movePath?: string;
  chunks: UpdateFileChunk[];
};

type Hunk = AddFileHunk | DeleteFileHunk | UpdateFileHunk;

export interface ApplyPatchSummary {
  added: string[];
  modified: string[];
  deleted: string[];
}

export async function applyPatchInWorkspace(
  input: string,
  workspace: string,
): Promise<{ summary: ApplyPatchSummary; text: string }> {
  const { hunks } = parsePatchText(input);
  if (hunks.length === 0) {
    throw new Error("No files were modified.");
  }

  const summary: ApplyPatchSummary = {
    added: [],
    modified: [],
    deleted: [],
  };

  for (const hunk of hunks) {
    if (hunk.kind === "add") {
      const targetPath = await resolvePatchPath(workspace, hunk.path);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, hunk.contents, "utf8");
      summary.added.push(path.relative(workspace, targetPath) || path.basename(targetPath));
      continue;
    }

    if (hunk.kind === "delete") {
      const targetPath = await resolvePatchPath(workspace, hunk.path);
      await fs.rm(targetPath);
      summary.deleted.push(path.relative(workspace, targetPath) || path.basename(targetPath));
      continue;
    }

    const targetPath = await resolvePatchPath(workspace, hunk.path);
    const updatedContent = await applyUpdateHunk(targetPath, hunk.chunks);

    if (hunk.movePath) {
      const moveTargetPath = await resolvePatchPath(workspace, hunk.movePath);
      await fs.mkdir(path.dirname(moveTargetPath), { recursive: true });
      await fs.writeFile(moveTargetPath, updatedContent, "utf8");
      await fs.rm(targetPath);
      summary.modified.push(path.relative(workspace, moveTargetPath) || path.basename(moveTargetPath));
      continue;
    }

    await fs.writeFile(targetPath, updatedContent, "utf8");
    summary.modified.push(path.relative(workspace, targetPath) || path.basename(targetPath));
  }

  return {
    summary,
    text: formatSummary(summary),
  };
}

async function resolvePatchPath(workspace: string, inputPath: string): Promise<string> {
  return resolveAllowedPath(workspace, inputPath, resolveToolApplyPatchRoots());
}

function formatSummary(summary: ApplyPatchSummary): string {
  const lines = ["Success. Updated the following files:"];
  for (const filePath of summary.added) {
    lines.push(`A ${filePath}`);
  }
  for (const filePath of summary.modified) {
    lines.push(`M ${filePath}`);
  }
  for (const filePath of summary.deleted) {
    lines.push(`D ${filePath}`);
  }
  return lines.join("\n");
}

function parsePatchText(input: string): { hunks: Hunk[] } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Invalid patch: input is empty.");
  }

  const lines = trimmed.split(/\r?\n/);
  const firstLine = lines[0]?.trim();
  const lastLine = lines[lines.length - 1]?.trim();
  if (firstLine !== BEGIN_PATCH_MARKER) {
    throw new Error("The first line of the patch must be '*** Begin Patch'");
  }
  if (lastLine !== END_PATCH_MARKER) {
    throw new Error("The last line of the patch must be '*** End Patch'");
  }

  const hunks: Hunk[] = [];
  let remaining = lines.slice(1, -1);
  let lineNumber = 2;

  while (remaining.length > 0) {
    if (remaining[0].trim() === "") {
      remaining = remaining.slice(1);
      lineNumber += 1;
      continue;
    }
    const { hunk, consumed } = parseOneHunk(remaining, lineNumber);
    hunks.push(hunk);
    remaining = remaining.slice(consumed);
    lineNumber += consumed;
  }

  return { hunks };
}

function parseOneHunk(lines: string[], lineNumber: number): { hunk: Hunk; consumed: number } {
  if (lines.length === 0) {
    throw new Error(`Invalid patch hunk at line ${lineNumber}: empty hunk`);
  }

  const firstLine = lines[0].trim();
  if (firstLine.startsWith(ADD_FILE_MARKER)) {
    const targetPath = firstLine.slice(ADD_FILE_MARKER.length);
    let contents = "";
    let consumed = 1;
    for (const line of lines.slice(1)) {
      if (!line.startsWith("+")) {
        break;
      }
      contents += `${line.slice(1)}\n`;
      consumed += 1;
    }
    return {
      hunk: { kind: "add", path: targetPath, contents },
      consumed,
    };
  }

  if (firstLine.startsWith(DELETE_FILE_MARKER)) {
    return {
      hunk: { kind: "delete", path: firstLine.slice(DELETE_FILE_MARKER.length) },
      consumed: 1,
    };
  }

  if (firstLine.startsWith(UPDATE_FILE_MARKER)) {
    const targetPath = firstLine.slice(UPDATE_FILE_MARKER.length);
    let remaining = lines.slice(1);
    let consumed = 1;
    let movePath: string | undefined;

    if (remaining[0]?.trim().startsWith(MOVE_TO_MARKER)) {
      movePath = remaining[0].trim().slice(MOVE_TO_MARKER.length);
      remaining = remaining.slice(1);
      consumed += 1;
    }

    const chunks: UpdateFileChunk[] = [];
    while (remaining.length > 0) {
      if (remaining[0].trim() === "") {
        remaining = remaining.slice(1);
        consumed += 1;
        continue;
      }
      if (remaining[0].startsWith("***")) {
        break;
      }

      const parsed = parseUpdateFileChunk(remaining, lineNumber + consumed, chunks.length === 0);
      chunks.push(parsed.chunk);
      remaining = remaining.slice(parsed.consumed);
      consumed += parsed.consumed;
    }

    if (chunks.length === 0) {
      throw new Error(
        `Invalid patch hunk at line ${lineNumber}: Update file hunk for path '${targetPath}' is empty`,
      );
    }

    return {
      hunk: { kind: "update", path: targetPath, movePath, chunks },
      consumed,
    };
  }

  throw new Error(
    `Invalid patch hunk at line ${lineNumber}: '${lines[0]}' is not a valid hunk header.`,
  );
}

function parseUpdateFileChunk(
  lines: string[],
  lineNumber: number,
  allowMissingContext: boolean,
): { chunk: UpdateFileChunk; consumed: number } {
  if (lines.length === 0) {
    throw new Error(`Invalid patch hunk at line ${lineNumber}: Update hunk is empty`);
  }

  let changeContext: string | undefined;
  let startIndex = 0;

  if (lines[0] === EMPTY_CHANGE_CONTEXT_MARKER) {
    startIndex = 1;
  } else if (lines[0].startsWith(CHANGE_CONTEXT_MARKER)) {
    changeContext = lines[0].slice(CHANGE_CONTEXT_MARKER.length);
    startIndex = 1;
  } else if (!allowMissingContext) {
    throw new Error(
      `Invalid patch hunk at line ${lineNumber}: Expected update hunk to start with a @@ context marker`,
    );
  }

  const chunk: UpdateFileChunk = {
    changeContext,
    oldLines: [],
    newLines: [],
    isEndOfFile: false,
  };

  let consumed = startIndex;
  for (const line of lines.slice(startIndex)) {
    if (line === EOF_MARKER) {
      chunk.isEndOfFile = true;
      consumed += 1;
      break;
    }

    if (!line) {
      chunk.oldLines.push("");
      chunk.newLines.push("");
      consumed += 1;
      continue;
    }

    const marker = line[0];
    if (marker === " ") {
      const content = line.slice(1);
      chunk.oldLines.push(content);
      chunk.newLines.push(content);
      consumed += 1;
      continue;
    }
    if (marker === "-") {
      chunk.oldLines.push(line.slice(1));
      consumed += 1;
      continue;
    }
    if (marker === "+") {
      chunk.newLines.push(line.slice(1));
      consumed += 1;
      continue;
    }
    break;
  }

  if (chunk.oldLines.length === 0 && chunk.newLines.length === 0) {
    throw new Error(`Invalid patch hunk at line ${lineNumber}: Update hunk does not contain any lines`);
  }

  return { chunk, consumed };
}

async function applyUpdateHunk(filePath: string, chunks: UpdateFileChunk[]): Promise<string> {
  const originalContents = await fs.readFile(filePath, "utf8").catch((error) => {
    throw new Error(`Failed to read file to update ${filePath}: ${String(error)}`);
  });

  const originalLines = originalContents.split("\n");
  if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
    originalLines.pop();
  }

  const replacements = computeReplacements(originalLines, filePath, chunks);
  let newLines = [...originalLines];

  for (const [startIndex, oldLineCount, replacementLines] of [...replacements].reverse()) {
    newLines.splice(startIndex, oldLineCount, ...replacementLines);
  }

  if (newLines.length === 0 || newLines[newLines.length - 1] !== "") {
    newLines = [...newLines, ""];
  }

  return newLines.join("\n");
}

function computeReplacements(
  originalLines: string[],
  filePath: string,
  chunks: UpdateFileChunk[],
): Array<[number, number, string[]]> {
  const replacements: Array<[number, number, string[]]> = [];
  let lineIndex = 0;

  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const contextIndex = seekSequence(originalLines, [chunk.changeContext], lineIndex, false);
      if (contextIndex === null) {
        throw new Error(`Failed to find context '${chunk.changeContext}' in ${filePath}`);
      }
      lineIndex = contextIndex + 1;
    }

    if (chunk.oldLines.length === 0) {
      replacements.push([lineIndex, 0, chunk.newLines]);
      lineIndex += chunk.newLines.length;
      continue;
    }

    let oldLines = chunk.oldLines;
    let newLines = chunk.newLines;
    let foundAt = seekSequence(originalLines, oldLines, lineIndex, chunk.isEndOfFile);

    if (foundAt === null && oldLines[oldLines.length - 1] === "") {
      oldLines = oldLines.slice(0, -1);
      if (newLines[newLines.length - 1] === "") {
        newLines = newLines.slice(0, -1);
      }
      foundAt = seekSequence(originalLines, oldLines, lineIndex, chunk.isEndOfFile);
    }

    if (foundAt === null) {
      throw new Error(`Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join("\n")}`);
    }

    replacements.push([foundAt, oldLines.length, newLines]);
    lineIndex = foundAt + oldLines.length;
  }

  return replacements.sort((left, right) => left[0] - right[0]);
}

function seekSequence(
  lines: string[],
  pattern: string[],
  start: number,
  endOfFile: boolean,
): number | null {
  if (pattern.length === 0) {
    return start;
  }
  if (pattern.length > lines.length) {
    return null;
  }

  const maxStart = lines.length - pattern.length;
  const searchStart = endOfFile ? maxStart : Math.max(0, start);
  if (searchStart > maxStart) {
    return null;
  }

  for (let index = searchStart; index <= maxStart; index += 1) {
    let matched = true;
    for (let offset = 0; offset < pattern.length; offset += 1) {
      if (lines[index + offset] !== pattern[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return index;
    }
  }

  return null;
}
