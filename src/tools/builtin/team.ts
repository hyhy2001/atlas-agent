import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";
import { getTeamManager } from "../../coordinator/team.js";
import type { AgentProfile } from "../../agent/runner.js";

interface TeamCreateInput {
  name: string;
  members: Array<{ name: string; profile: AgentProfile }>;
}

interface TeamDeleteInput {
  name: string;
}

interface SendMessageInput {
  team: string;
  to: string;
  message: string;
}

function ok(content: string): ToolResult {
  return { toolUseId: "", content, isError: false };
}

function err(content: string): ToolResult {
  return { toolUseId: "", content, isError: true };
}

export const teamCreateTool: ToolDefinition = {
  name: "team_create",
  description: "Create an in-memory team of named subagents.",
  inputSchema: {
    properties: {
      name: { type: "string", description: "Team name" },
      members: {
        type: "array",
        description: "Team members with names and profiles",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            profile: { type: "string", enum: ["atlas-swift", "atlas-forge", "atlas-deep"] },
          },
          required: ["name", "profile"],
        },
      },
    },
    required: ["name", "members"],
  },
  isDestructive: false,
  async execute(input: unknown, _ctx: ExecutionContext): Promise<ToolResult> {
    const { name, members } = input as TeamCreateInput;
    try {
      const team = getTeamManager().create(name, members);
      const memberNames = Array.from(team.members.keys()).join(", ");
      return ok(`Team "${name}" created with ${team.members.size} members: ${memberNames}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(message);
    }
  },
};

export const teamDeleteTool: ToolDefinition = {
  name: "team_delete",
  description: "Delete an in-memory team by name.",
  inputSchema: {
    properties: {
      name: { type: "string", description: "Team name" },
    },
    required: ["name"],
  },
  isDestructive: false,
  async execute(input: unknown, _ctx: ExecutionContext): Promise<ToolResult> {
    const { name } = input as TeamDeleteInput;
    const deleted = getTeamManager().delete(name);
    if (!deleted) return err(`Team "${name}" not found`);
    return ok(`Team "${name}" deleted`);
  },
};

export const sendMessageTool: ToolDefinition = {
  name: "send_message",
  description: "Send a message to a team member mailbox.",
  inputSchema: {
    properties: {
      team: { type: "string", description: "Team name" },
      to: { type: "string", description: "Recipient member name" },
      message: { type: "string", description: "Message content" },
    },
    required: ["team", "to", "message"],
  },
  isDestructive: false,
  async execute(input: unknown, _ctx: ExecutionContext): Promise<ToolResult> {
    const { team, to, message } = input as SendMessageInput;
    try {
      getTeamManager().sendMessage(team, to, message);
      return ok(`Message sent to ${to} in team ${team}`);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      return err(messageText);
    }
  },
};
