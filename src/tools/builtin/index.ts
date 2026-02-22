import { echoTool } from "./echo.js";
import { listDirTool } from "./listDir.js";
import { pwdTool } from "./pwd.js";
import { readFileTool } from "./readFile.js";
import { timeNowTool } from "./timeNow.js";
import type { ToolSpec } from "../types.js";

export const builtinTools: ToolSpec[] = [
  timeNowTool,
  echoTool,
  pwdTool,
  listDirTool,
  readFileTool,
];
