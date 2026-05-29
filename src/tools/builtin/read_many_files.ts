import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";

interface FileSpec {
  path: string;
  offset?: number;
  limit?: number;
}

export const readManyFilesTool: ToolDefinition = {
  name: "read_many_files",
  description: "Read multiple files in one call. More efficient than calling read_file repeatedly. Each file can have optional offset (1-indexed line) and limit.",
  inputSchema: {
    properties: {
      files: {
        type: "array",
        items: {
          oneOf: [
            { type: "string", description: "File path" },
            {
              type: "object",
              properties: {
                path: { type: "string" },
                offset: { type: "number", description: "Starting line (1-indexed)" },
                limit: { type: "number", description: "Max lines to read" },
              },
              required: ["path"],
            },
          ],
        },
        description: "Array of file paths or {path, offset, limit} objects",
      },
      max_total_lines: {
        type: "number",
        description: "Truncate output if total lines exceed this (default 5000)",
      },
    },
    required: ["files"],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { files, max_total_lines = 5000 } = input as { files: Array<string | FileSpec>; max_total_lines?: number };

    if (!files || files.length === 0) {
      return { toolUseId: "", content: "Error: no files provided", isError: true };
    }

    const results: string[] = [];
    let totalLines = 0;
    let truncated = false;

    for (const item of files) {
      const spec: FileSpec = typeof item === "string" ? { path: item } : item;
      const fullPath = resolve(ctx.workingDir, spec.path);

      if (totalLines >= max_total_lines) {
        truncated = true;
        results.push(`\n=== ${spec.path} ===\n(skipped — total line limit reached)\n`);
        continue;
      }

      try {
        const content = await readFile(fullPath, "utf-8");
        const lines = content.split("\n");

        const start = (spec.offset ?? 1) - 1;
        const end = spec.limit ? start + spec.limit : lines.length;
        const slice = lines.slice(start, end);

        const remaining = max_total_lines - totalLines;
        const finalSlice = slice.slice(0, remaining);
        if (finalSlice.length < slice.length) truncated = true;

        const numbered = finalSlice
          .map((line, i) => `${String(start + i + 1).padStart(5)}\t${line}`)
          .join("\n");

        results.push(`\n=== ${spec.path} ===\n${numbered}`);
        if (slice.length > finalSlice.length) {
          results.push(`(... ${slice.length - finalSlice.length} more lines truncated)`);
        }
        totalLines += finalSlice.length;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push(`\n=== ${spec.path} ===\nError: ${msg}`);
      }
    }

    let output = results.join("\n");
    if (truncated) {
      output += `\n\n[Output truncated at ${max_total_lines} lines total]`;
    }

    return { toolUseId: "", content: output, isError: false };
  },
};
