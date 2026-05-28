import type { ToolDefinition } from "../types.js";
import { readFileTool } from "./read_file.js";
import { writeFileTool } from "./write_file.js";
import { editFileTool } from "./edit_file.js";
import { bashTool } from "./bash.js";
import { grepTool } from "./grep.js";
import { listDirectoryTool } from "./list_directory.js";
import { globTool } from "./glob.js";
import { webFetchTool } from "./web_fetch.js";
import { todoReadTool, todoWriteTool } from "./todo.js";

export const builtinTools: ToolDefinition[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  bashTool,
  grepTool,
  listDirectoryTool,
  globTool,
  webFetchTool,
  todoReadTool,
  todoWriteTool,
];
