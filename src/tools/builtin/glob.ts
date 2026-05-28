import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";

const EXCLUDED = ["node_modules", ".git", "dist", ".next", "__pycache__"];

async function findFiles(pattern: string, cwd: string, exclude: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const excludeArgs = exclude.flatMap(e => ["-not", "-path", `*/${e}/*`]);
    const child = spawn("find", [cwd, "-type", "f", "-name", pattern, ...excludeArgs], { cwd });
    let stdout = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.on("close", (code) => {
      const files = stdout.trim().split("\n").filter(Boolean).map(f => path.relative(cwd, f));
      resolve(files);
    });
    child.on("error", () => resolve([]));
  });
}

export const globTool: ToolDefinition = {
  name: "glob",
  description: "Find files matching a pattern. Use to discover files before reading them.",
  inputSchema: {
    properties: {
      pattern: { type: "string", description: "File name pattern (e.g. *.ts, *.sv)" },
      path: { type: "string", description: "Base directory to search from" },
      exclude: { type: "array", items: { type: "string" }, description: "Directories to exclude" },
    },
    required: ["pattern"],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { pattern, path: searchPath, exclude } = input as { pattern: string; path?: string; exclude?: string[] };
    const cwd = searchPath ? path.resolve(ctx.workingDir, searchPath) : ctx.workingDir;
    const excludeDirs = exclude ?? EXCLUDED;
    try {
      const files = await findFiles(pattern, cwd, excludeDirs);
      if (files.length === 0) return { toolUseId: "", content: "No files found matching pattern.", isError: false };
      const truncated = files.length > 500;
      const result = files.slice(0, 500).join("\n");
      return { toolUseId: "", content: truncated ? result + `\n\n(truncated: ${files.length} total matches)` : result, isError: false };
    } catch (err) {
      return { toolUseId: "", content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
