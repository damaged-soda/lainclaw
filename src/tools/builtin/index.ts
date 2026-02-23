import { echoTool } from "./echo.js";
import { listDirTool } from "./listDir.js";
import { editFileTool } from "./editFile.js";
import { pwdTool } from "./pwd.js";
import { readFileTool } from "./readFile.js";
import { writeFileTool } from "./writeFile.js";
import { timeNowTool } from "./timeNow.js";
import type { ToolSpec } from "../types.js";

export const builtinTools: ToolSpec[] = [
  timeNowTool,
  echoTool,
  pwdTool,
  listDirTool,
  editFileTool,
  readFileTool,
  writeFileTool,
];
