import path from "node:path";
import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";

export const trustCommand: LocalCommand = {
  kind: "local",
  name: "trust",
  description: "Trust a directory to skip permission prompts",
  argumentHint: "[dir]",
  source: "builtin",
  call(ctx: SlashCommandContext): LocalCommandResult {
    const dir = ctx.args.trim() || ".";
    const resolved = path.resolve(ctx.cwd, dir);
    const executor = ctx.app?.["executor"] as { ctx?: { trustedDirs?: string[] } } | undefined;
    const trustedDirs = executor?.ctx?.trustedDirs ?? [];
    if (!trustedDirs.includes(resolved)) trustedDirs.push(resolved);
    if (executor?.ctx) executor.ctx.trustedDirs = trustedDirs;
    return { type: "text", value: `Trusted: ${resolved} (no permission prompts for files in this directory)` };
  },
};
