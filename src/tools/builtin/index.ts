import { applyPatchTool } from "./applyPatch.js";
import { editTool } from "./edit.js";
import { execTool } from "./exec.js";
import { globTool } from "./glob.js";
import { listDirTool } from "./listDir.js";
import { pathDescribeTool } from "./pathDescribe.js";
import { processTool } from "./process.js";
import { readTool } from "./read.js";
import { sendMessageTool } from "./sendMessage.js";
import { writeTool } from "./write.js";
import type { ToolSpec } from "../types.js";

export const builtinTools: ToolSpec[] = [
  readTool,
  writeTool,
  editTool,
  applyPatchTool,
  execTool,
  globTool,
  listDirTool,
  pathDescribeTool,
  processTool,
  sendMessageTool,
];
