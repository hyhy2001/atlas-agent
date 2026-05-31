import { spawn } from "node:child_process";
import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";

export const diffCommand: LocalCommand = {
  kind: "local",
  name: "diff",
  description: "Show git diff for current changes",
  argumentHint: "[path]",
  source: "builtin",
  async call(ctx: SlashCommandContext): Promise<LocalCommandResult> {
    const arg = ctx.args.trim();
    const stat = await new Promise<string>(resolve => {
      const child = spawn("git", ["diff", "--stat", ...(arg ? ["--", arg] : [])], { cwd: ctx.cwd });
      let out = "";
      child.stdout.on("data", d => { out += d.toString(); });
      child.on("close", () => resolve(out.trim()));
    });
    const full = await new Promise<string>(resolve => {
      const child = spawn("git", ["diff", "--color=always", ...(arg ? ["--", arg] : [])], { cwd: ctx.cwd });
      let out = "";
      child.stdout.on("data", d => { out += d.toString(); });
      child.stderr.on("data", d => { out += d.toString(); });
      child.on("close", () => resolve(out));
    });

    if (!stat && !full.trim()) return { type: "text", value: "No changes." };
    const fileCount = stat.split("\n").filter(l => l.includes("|")).length;
    const header = stat ? `── ${fileCount} file${fileCount !== 1 ? "s" : ""} changed ──\n${stat}\n${"─".repeat(40)}\n` : "";
    return { type: "text", value: header + full.trim() };
  },
};
