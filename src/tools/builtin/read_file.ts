import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description:
    "Read the contents of a file. Returns lines with line numbers. Supports offset and limit for partial reads.",
  inputSchema: {
    properties: {
      path: { type: "string", description: "Absolute or relative file path" },
      offset: { type: "number", description: "Line number to start from (0-based)" },
      limit: { type: "number", description: "Max number of lines to return (default 2000)" },
    },
    required: ["path"],
  },
  isDestructive: false,

  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { path, offset = 0, limit = 2000 } = input as {
      path: string;
      offset?: number;
      limit?: number;
    };

    const fullPath = resolve(ctx.workingDir, path);

    try {
      const content = await readFile(fullPath, "utf-8");
      const lines = content.split("\n");
      const sliced = lines.slice(offset, offset + limit);
      const numbered = sliced.map(
        (line, i) => `${(offset + i + 1).toString().padStart(6)}\t${line}`
      );
      return { toolUseId: "", content: numbered.join("\n"), isError: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { toolUseId: "", content: `Error reading file: ${msg}`, isError: true };
    }
  },
};
