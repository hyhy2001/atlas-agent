import type { LocalCommand, LocalCommandResult } from "../types.js";

export const teamCommand: LocalCommand = {
  kind: "local",
  name: "team",
  description: "List active team definitions",
  source: "builtin",
  async call(): Promise<LocalCommandResult> {
    const { getTeamManager } = await import("../../../coordinator/team.js");
    const teams = getTeamManager().list();

    if (teams.length === 0) return { type: "text", value: "No teams." };

    const lines = teams.map(t => {
      const members = Array.from(t.members.values()).map(m => `${m.name}(${m.profile})`).join(", ");
      return `  ${t.name} — ${t.members.size} members: ${members}`;
    });

    return { type: "text", value: `Teams (${teams.length}):\n${lines.join("\n")}` };
  },
};
