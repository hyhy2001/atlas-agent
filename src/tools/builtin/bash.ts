import { spawn } from "node:child_process";
import { loadExecPolicy, checkCommand } from "../../execpolicy.js";
import { wrapCommand } from "../../sandbox.js";
import { resolve } from "node:path";
import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";

const MAX_OUTPUT = 50000;

export const bashTool: ToolDefinition = {
  name: "bash",
  description: "Execute a bash command and return its output (stdout + stderr combined).",
  inputSchema: {
    properties: {
      command: { type: "string", description: "The bash command to execute" },
      timeout: {
        type: "number",
        description: "Timeout in seconds (default 30, max 300)",
      },
    },
    required: ["command"],
  },
  isDestructive: true,

  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { command, timeout = 30 } = input as { command: string; timeout?: number };
    const effectiveTimeout = Math.min(Math.max(timeout, 1), 300) * 1000;

    const policy = loadExecPolicy();
    const check = checkCommand(command, policy);
    if (!check.allowed) {
      return { toolUseId: "", content: check.reason ?? "Command blocked by execpolicy", isError: true };
    }

    const sandboxedCommand = wrapCommand(command, { timeout: timeout ?? 30 });

    return new Promise<ToolResult>((resolvePromise) => {
      const child = spawn(sandboxedCommand, {
        shell: true,
        cwd: resolve(ctx.workingDir),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";

      const onAbort = () => {
        child.kill("SIGTERM");
      };
      ctx.abortSignal.addEventListener("abort", onAbort, { once: true });

      child.stdout?.on("data", (data: Buffer) => {
        output += data.toString();
      });

      child.stderr?.on("data", (data: Buffer) => {
        output += data.toString();
      });

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        output += "\n[Process timed out]";
      }, effectiveTimeout);

      child.on("close", (code) => {
        clearTimeout(timer);
        ctx.abortSignal.removeEventListener("abort", onAbort);

        let content = output;
        if (content.length > MAX_OUTPUT) {
          content = content.slice(0, MAX_OUTPUT) + "\n[Output truncated]";
        }
        if (code !== 0) {
          content += `\n[Exit code: ${code}]`;
        }

        resolvePromise({ toolUseId: "", content, isError: code !== 0 });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        ctx.abortSignal.removeEventListener("abort", onAbort);
        resolvePromise({
          toolUseId: "",
          content: `Error spawning process: ${err.message}`,
          isError: true,
        });
      });
    });
  },
};
