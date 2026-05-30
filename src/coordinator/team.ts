import { runSubagent, type AgentProfile } from "../agent/runner.js";
import type { ExecutionContext } from "../tools/types.js";

export interface TeamMember {
  name: string;
  profile: AgentProfile;
  mailbox: string[];
}

export interface Team {
  name: string;
  members: Map<string, TeamMember>;
  createdAt: string;
}

export interface TeamRunResult {
  member: string;
  output: string;
  toolUseCount: number;
  durationMs: number;
  error?: string;
}

export class TeamManager {
  private teams = new Map<string, Team>();

  create(name: string, members: Array<{ name: string; profile: AgentProfile }>): Team {
    if (this.teams.has(name)) throw new Error(`Team "${name}" already exists`);
    const team: Team = {
      name,
      members: new Map(members.map((member) => [member.name, { name: member.name, profile: member.profile, mailbox: [] }])),
      createdAt: new Date().toISOString(),
    };
    this.teams.set(name, team);
    return team;
  }

  get(name: string): Team | null {
    return this.teams.get(name) ?? null;
  }

  list(): Team[] {
    return Array.from(this.teams.values());
  }

  delete(name: string): boolean {
    return this.teams.delete(name);
  }

  sendMessage(teamName: string, toMember: string, message: string): void {
    const team = this.teams.get(teamName);
    if (!team) throw new Error(`Team "${teamName}" not found`);
    const member = team.members.get(toMember);
    if (!member) throw new Error(`Member "${toMember}" not found in team "${teamName}"`);
    member.mailbox.push(message);
  }

  async runTeam(
    teamName: string,
    memberTasks: Record<string, string>,
    ctx: ExecutionContext,
  ): Promise<TeamRunResult[]> {
    const team = this.teams.get(teamName);
    if (!team) throw new Error(`Team "${teamName}" not found`);

    const runs = Array.from(team.members.values()).map(async (member): Promise<TeamRunResult> => {
      const baseTask = memberTasks[member.name] ?? `You are ${member.name}. Await instructions.`;
      const mailboxPrefix = member.mailbox.length > 0
        ? `Messages for you:\n${member.mailbox.map((message, index) => `[${index + 1}] ${message}`).join("\n")}\n\n`
        : "";
      member.mailbox = [];
      const fullTask = mailboxPrefix + baseTask;

      const result = await runSubagent({ profile: member.profile, task: fullTask }, ctx);
      return {
        member: member.name,
        output: result.output,
        toolUseCount: result.toolUseCount,
        durationMs: result.durationMs,
        error: result.error,
      };
    });

    return Promise.all(runs);
  }
}

let instance: TeamManager | null = null;

export function getTeamManager(): TeamManager {
  if (!instance) instance = new TeamManager();
  return instance;
}
