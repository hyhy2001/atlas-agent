import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";

export const executeCommand: LocalCommand = {
  kind: "local",
  name: "execute",
  description: "Disable plan mode",
  aliases: ["do"],
  source: "builtin",
  call(ctx: SlashCommandContext): LocalCommandResult {
    const exitPlanMode = ctx.app?.["exitPlanMode"] as (() => void) | undefined;
    exitPlanMode?.();
    return { type: "text", value: "[Plan mode OFF — agent can now modify files]" };
  },
};
