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
import { delegateTool, delegateParallelTool } from "./delegate.js";
import { memorySaveTool, memoryAppendTool, memoryReadTool, memoryDeleteTool } from "./memory.js";
import { gitStatusTool, gitDiffTool, gitLogTool, gitCommitTool } from "./git.js";
import { applyPatchTool } from "./apply_patch.js";
import { readManyFilesTool } from "./read_many_files.js";
import { analyzeLogTool } from "./analyze_log.js";
import { askUserQuestionTool } from "./ask_user_question.js";
import { lspTool } from "./lsp.js";
import { taskCreateTool, taskGetTool, taskListTool, taskUpdateTool, taskDeleteTool } from "./task.js";
import { cronCreateTool, cronListTool, cronDeleteTool } from "./cron.js";
import { teamCreateTool, teamDeleteTool, sendMessageTool } from "./team.js";

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
  delegateTool,
  delegateParallelTool,
  memorySaveTool,
  memoryAppendTool,
  memoryReadTool,
  memoryDeleteTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitCommitTool,
  applyPatchTool,
  readManyFilesTool,
  analyzeLogTool,
  askUserQuestionTool,
  lspTool,
  taskCreateTool,
  taskGetTool,
  taskListTool,
  taskUpdateTool,
  taskDeleteTool,
  cronCreateTool,
  cronListTool,
  cronDeleteTool,
  teamCreateTool,
  teamDeleteTool,
  sendMessageTool,
];
