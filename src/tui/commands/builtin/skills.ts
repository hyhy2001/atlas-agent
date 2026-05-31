import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";
import type { Skill } from "../../../skills.js";

export const skillsCommand: LocalCommand = {
  kind: "local",
  name: "skills",
  description: "List loaded skills",
  source: "builtin",
  call(ctx: SlashCommandContext): LocalCommandResult {
    const skills = (ctx.app?.["skills"] as Skill[] | undefined) ?? [];
    if (skills.length === 0) {
      return {
        type: "text",
        value: "No skills loaded.\n\nAdd skill files to ~/.atlas/skills/ or .atlas/skills/",
      };
    }
    const lines = [`Skills (${skills.length}):`];
    for (const skill of skills) {
      lines.push(`  /${skill.name}  — ${skill.description}`);
      if (skill.source) lines.push(`    source: ${skill.source}`);
    }
    return { type: "text", value: lines.join("\n") };
  },
};
