import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";

const MAX_OUTPUT = 50000;

export const grepTool: ToolDefinition = {
  name: "grep",
  description:
    "Search for a pattern in files using grep (or ripgrep if available). Returns matching lines with file paths and line numbers.",
  inputSchema: {
    properties: {
      pattern: { type: "string", description: "Search pattern (regex)" },
      path: { type: "string", description: "Directory or file to search (default: current dir)" },
      include: { type: "string", description: "Glob pattern for file inclusion (e.g. *.ts)" },
    },
    required: ["pattern"],
  },
  isDestructive: false,

  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { pattern, path = ".", include } = input as {
      pattern: string;
      path?: string;
      include?: string;
    };

    const searchPath = resolve(ctx.workingDir, path);
    const args = ["-rn"];
    if (include) {
      args.push(`--include=${include}`);
    }
    args.push(pattern, searchPath);

    return new Promise<ToolResult>((resolvePromise) => {
      const child = spawn("grep", args, {
        cwd: ctx.workingDir,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";

      child.stdout?.on("data", (data: Buffer) => {
        output += data.toString();
      });

      child.stderr?.on("data", (data: Buffer) => {
        output += data.toString();
      });

      child.on("close", () => {
        let content = output.trim();
        if (content.length > MAX_OUTPUT) {
          content = content.slice(0, MAX_OUTPUT) + "\n[Output truncated]";
        }
        if (!content) {
          content = "No matches found";
        }
        resolvePromise({ toolUseId: "", content, isError: false });
      });

      child.on("error", (err) => {
        resolvePromise({
          toolUseId: "",
          content: `Error running grep: ${err.message}`,
          isError: true,
        });
      });
    });
  },
};
