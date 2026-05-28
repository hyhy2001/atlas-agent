import { spawn } from "node:child_process";
import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";

function runGit(args: string[], cwd: string, timeout = 10000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, shell: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => { child.kill(); resolve({ stdout, stderr: "timeout", code: 1 }); }, timeout);
    child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, code: code ?? 1 }); });
    child.on("error", (err) => { clearTimeout(timer); resolve({ stdout: "", stderr: err.message, code: 1 }); });
  });
}

export const gitStatusTool: ToolDefinition = {
  name: "git_status",
  description: "Show git working tree status (staged, unstaged, untracked files).",
  inputSchema: { properties: {}, required: [] },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { stdout, stderr, code } = await runGit(["status", "--short"], ctx.workingDir);
    if (code !== 0) return { toolUseId: "", content: `Error: ${stderr}`, isError: true };
    return { toolUseId: "", content: stdout || "(clean working tree)", isError: false };
  },
};

export const gitDiffTool: ToolDefinition = {
  name: "git_diff",
  description: "Show git diff of changes. Use path to scope to specific files.",
  inputSchema: {
    properties: {
      path: { type: "string", description: "File or directory to diff (optional, defaults to all)" },
      staged: { type: "boolean", description: "Show staged changes only (default: false)" },
    },
    required: [],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { path, staged } = (input as { path?: string; staged?: boolean }) || {};
    const args = ["diff"];
    if (staged) args.push("--cached");
    if (path) args.push("--", path);
    const { stdout, stderr, code } = await runGit(args, ctx.workingDir);
    if (code !== 0) return { toolUseId: "", content: `Error: ${stderr}`, isError: true };
    return { toolUseId: "", content: stdout || "(no changes)", isError: false };
  },
};

export const gitLogTool: ToolDefinition = {
  name: "git_log",
  description: "Show recent git commit history.",
  inputSchema: {
    properties: {
      count: { type: "number", description: "Number of commits to show (default: 10)" },
      path: { type: "string", description: "Filter to specific file/directory" },
      oneline: { type: "boolean", description: "One line per commit (default: true)" },
    },
    required: [],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { count = 10, path, oneline = true } = (input as { count?: number; path?: string; oneline?: boolean }) || {};
    const args = ["log", `-${count}`];
    if (oneline) args.push("--oneline");
    if (path) args.push("--", path);
    const { stdout, stderr, code } = await runGit(args, ctx.workingDir);
    if (code !== 0) return { toolUseId: "", content: `Error: ${stderr}`, isError: true };
    return { toolUseId: "", content: stdout || "(no commits)", isError: false };
  },
};

export const gitCommitTool: ToolDefinition = {
  name: "git_commit",
  description: "Stage files and create a git commit. DESTRUCTIVE: modifies git history.",
  inputSchema: {
    properties: {
      message: { type: "string", description: "Commit message" },
      files: { type: "array", items: { type: "string" }, description: "Files to stage (default: all modified)" },
      all: { type: "boolean", description: "Stage all modified/deleted files (-a flag)" },
    },
    required: ["message"],
  },
  isDestructive: true,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { message, files, all } = input as { message: string; files?: string[]; all?: boolean };

    // Stage files
    if (files && files.length > 0) {
      const { code, stderr } = await runGit(["add", ...files], ctx.workingDir);
      if (code !== 0) return { toolUseId: "", content: `Stage error: ${stderr}`, isError: true };
    } else if (all) {
      const { code, stderr } = await runGit(["add", "-A"], ctx.workingDir);
      if (code !== 0) return { toolUseId: "", content: `Stage error: ${stderr}`, isError: true };
    }

    // Commit
    const { stdout, stderr, code } = await runGit(["commit", "-m", message], ctx.workingDir);
    if (code !== 0) return { toolUseId: "", content: `Commit error: ${stderr}`, isError: true };
    return { toolUseId: "", content: stdout.trim(), isError: false };
  },
};
