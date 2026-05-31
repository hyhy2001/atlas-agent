import path from "node:path";
import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";

export const worktreeCommand: LocalCommand = {
  kind: "local",
  name: "worktree",
  description: "Manage git worktrees for parallel tasks",
  argumentHint: "[list|create <name>|enter <name>|exit|remove <name>]",
  source: "builtin",
  async call(ctx: SlashCommandContext): Promise<LocalCommandResult> {
    const { listWorktrees, createWorktree, removeWorktree, hasUncommittedChanges } = await import("../../../worktree.js");
    const rootCwd = (ctx.app?.["replStartCwd"] as string | undefined) ?? ctx.cwd;
    const parts = ["worktree", ...ctx.args.trim().split(/\s+/).filter(Boolean)];
    const subcmd = parts[1] ?? "list";

    if (subcmd === "list") {
      const wts = await listWorktrees(rootCwd);
      return { type: "text", value: wts.length ? wts.map(wt => `  ${wt.branch}  ${wt.path}`).join("\n") : "No worktrees." };
    }

    if (subcmd === "create") {
      const name = parts[2];
      if (!name) return { type: "text", value: "Usage: /worktree create <name>" };
      const result = await createWorktree(rootCwd, name);
      return {
        type: "text",
        value: result.error
          ? `Error: ${result.error}`
          : `Created worktree: ${result.path}\nBranch: atlas/${name}\nUse /worktree enter ${name} to switch into it`,
      };
    }

    if (subcmd === "enter") {
      const name = parts[2];
      if (!name) return { type: "text", value: "Usage: /worktree enter <name>" };
      const fsSync = await import("node:fs");
      const wtPath = path.join(rootCwd, ".atlas", "worktrees", name);
      if (!fsSync.existsSync(wtPath)) return { type: "text", value: `Worktree not found: ${name}` };
      process.chdir(wtPath);
      return { type: "text", value: `Switched to worktree: ${wtPath}` };
    }

    if (subcmd === "exit") {
      if (process.cwd() === rootCwd) return { type: "text", value: "Not currently in a worktree." };
      process.chdir(rootCwd);
      return { type: "text", value: `Returned to: ${rootCwd}` };
    }

    if (subcmd === "remove" || subcmd === "rm") {
      const name = parts[2];
      if (!name) return { type: "text", value: "Usage: /worktree remove <name>" };
      const wtPath = path.join(rootCwd, ".atlas", "worktrees", name);
      const force = parts[3] === "--force";
      if (await hasUncommittedChanges(wtPath) && !force) {
        return { type: "text", value: "Worktree has uncommitted changes. Add --force to remove anyway." };
      }
      const result = await removeWorktree(rootCwd, name, force);
      return { type: "text", value: result.error ? `Error: ${result.error}` : `Removed worktree: ${name}` };
    }

    return { type: "text", value: "Usage: /worktree [list|create <name>|enter <name>|exit|remove <name>]" };
  },
};
