import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";

export const planCommand: LocalCommand = {
  kind: "local",
  name: "plan",
  description: "Enable plan mode",
  source: "builtin",
  call(ctx: SlashCommandContext): LocalCommandResult {
    const enterPlanMode = ctx.app?.["enterPlanMode"] as (() => void) | undefined;
    enterPlanMode?.();
    return { type: "text", value: "[Plan mode ON — agent can only read, not modify]" };
  },
};
