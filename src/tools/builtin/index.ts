import { applyPatchTool } from "./applyPatch.js";
import { editTool } from "./edit.js";
import { execTool } from "./exec.js";
import { processTool } from "./process.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import type { ToolSpec } from "../types.js";

export const builtinTools: ToolSpec[] = [
  readTool,
  writeTool,
  editTool,
  applyPatchTool,
  execTool,
  processTool,
];
