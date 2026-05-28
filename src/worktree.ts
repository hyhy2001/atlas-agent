import { spawn } from "node:child_process";
import { join } from "node:path";

export function runGit(args: string[], cwd: string, timeout = 15000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => { child.kill(); resolve({ stdout, stderr: "timeout", code: 1 }); }, timeout);
    child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, code: code ?? 1 }); });
    child.on("error", (err) => { clearTimeout(timer); resolve({ stdout: "", stderr: err.message, code: 1 }); });
  });
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const { stdout, code } = await runGit(["worktree", "list", "--porcelain"], cwd);
  if (code !== 0) return [];

  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) current.path = line.slice(9);
    else if (line.startsWith("HEAD ")) current.head = line.slice(5);
    else if (line.startsWith("branch ")) current.branch = line.slice(7).replace("refs/heads/", "");
    else if (line === "") {
      if (current.path) worktrees.push({ path: current.path, branch: current.branch ?? "(detached)", head: current.head ?? "" });
      current = {};
    }
  }
  if (current.path) worktrees.push({ path: current.path, branch: current.branch ?? "(detached)", head: current.head ?? "" });
  return worktrees;
}

export async function createWorktree(cwd: string, name: string, branchFrom = "HEAD"): Promise<{ path: string; error?: string }> {
  const wtPath = join(cwd, ".atlas", "worktrees", name);
  const branch = `atlas/${name}`;
  const { code, stderr } = await runGit(["worktree", "add", "-b", branch, wtPath, branchFrom], cwd);
  if (code !== 0) return { path: wtPath, error: stderr };
  return { path: wtPath };
}

export async function removeWorktree(cwd: string, name: string, force = false): Promise<{ ok: boolean; error?: string }> {
  const wtPath = join(cwd, ".atlas", "worktrees", name);
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(wtPath);
  const { code, stderr } = await runGit(args, cwd);
  if (code !== 0) return { ok: false, error: stderr };
  return { ok: true };
}

export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  const { stdout } = await runGit(["status", "--porcelain"], cwd);
  return stdout.trim().length > 0;
}
