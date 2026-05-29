import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";
import { pushUndo } from "../../undo.js";

export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description:
    "Edit a file by replacing an exact string occurrence. The old_string must appear exactly once in the file.",
  inputSchema: {
    properties: {
      path: { type: "string", description: "Absolute or relative file path" },
      old_string: { type: "string", description: "Exact string to find (must be unique)" },
      new_string: { type: "string", description: "Replacement string" },
    },
    required: ["path", "old_string", "new_string"],
  },
  isDestructive: true,

  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { path, old_string, new_string } = input as {
      path: string;
      old_string: string;
      new_string: string;
    };
    const fullPath = resolve(ctx.workingDir, path);

    try {
      const content = await readFile(fullPath, "utf-8");

      const occurrences = content.split(old_string).length - 1;
      if (occurrences === 0) {
        return {
          toolUseId: "",
          content: "Error: old_string not found in file",
          isError: true,
        };
      }
      if (occurrences > 1) {
        return {
          toolUseId: "",
          content: `Error: old_string found ${occurrences} times (must be unique)`,
          isError: true,
        };
      }

      const newContent = content.replace(old_string, new_string);
      pushUndo({ path: fullPath, previousContent: content, timestamp: Date.now() });
      await writeFile(fullPath, newContent, "utf-8");
      const { formatToolDiff } = await import("./diff_helper.js");
      return { toolUseId: "", content: formatToolDiff(path, content, newContent), isError: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { toolUseId: "", content: `Error editing file: ${msg}`, isError: true };
    }
  },
};
