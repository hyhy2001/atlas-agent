import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";
import type { SubagentProfile } from "../../../agent/subagents.js";

export const agentsCommand: LocalCommand = {
  kind: "local",
  name: "agents",
  description: "List available subagents",
  source: "builtin",
  call(ctx: SlashCommandContext): LocalCommandResult {
    const agents = (ctx.app?.["subagents"] as SubagentProfile[] | undefined) ?? [];
    return {
      type: "text",
      value: "Available agents:\n" + agents.map(a => `  ${a.name}  — ${a.description}`).join("\n"),
    };
  },
};
