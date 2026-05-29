import { writeFile, mkdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";
import { pushUndo } from "../../undo.js";

export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file. Creates parent directories if needed.",
  inputSchema: {
    properties: {
      path: { type: "string", description: "Absolute or relative file path" },
      content: { type: "string", description: "Content to write" },
    },
    required: ["path", "content"],
  },
  isDestructive: true,

  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { path, content } = input as { path: string; content: string };
    const fullPath = resolve(ctx.workingDir, path);

    try {
      await mkdir(dirname(fullPath), { recursive: true });
      let previousContent: string | null = null;
      try { previousContent = await readFile(fullPath, "utf-8"); } catch {}
      pushUndo({ path: fullPath, previousContent, timestamp: Date.now() });
      await writeFile(fullPath, content, "utf-8");
      const { formatToolDiff, formatNewFile } = await import("./diff_helper.js");
      const diff = previousContent === null
        ? formatNewFile(path, content)
        : formatToolDiff(path, previousContent, content);
      return { toolUseId: "", content: diff, isError: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { toolUseId: "", content: `Error writing file: ${msg}`, isError: true };
    }
  },
};
