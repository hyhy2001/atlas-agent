import type { ToolDef } from "../provider/types.js";
import type { ToolDefinition } from "./types.js";

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  toOpenAITools(): ToolDef[] {
    return this.getAll().map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          ...tool.inputSchema,
        },
      },
    }));
  }

  toAnthropicTools(): ToolDef[] {
    return this.toOpenAITools();
  }

  filterForLeader(): ToolRegistry {
    const filtered = new ToolRegistry();
    const leaderTools = new Set([
      "delegate",
      "delegate_parallel",
      "todo_read",
      "todo_write",
      "memory_save",
      "memory_append",
      "memory_read",
      "ask_user_question",
      "task_create",
      "task_list",
      "task_update",
      "cron_create",
      "team_create",
    ]);
    for (const tool of this.getAll()) {
      // MCP tools use "server__tool" naming convention — always expose to leader
      // so it can use codebase-memory, figma, and other MCP servers directly.
      if (leaderTools.has(tool.name) || tool.name.includes("__")) {
        filtered.register(tool);
      }
    }
    return filtered;
  }
}
