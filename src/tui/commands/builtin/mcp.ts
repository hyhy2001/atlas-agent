import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";

type McpStatus = {
  name: string;
  command: string;
  status: "connected" | "failed";
  toolCount: number;
  error?: string;
};

export const mcpCommand: LocalCommand = {
  kind: "local",
  name: "mcp",
  description: "List connected MCP servers and their tools",
  source: "builtin",
  call(ctx: SlashCommandContext): LocalCommandResult {
    const app = ctx.app ?? {};
    const all = (app["tools"] as Array<{ name: string }> | undefined) ?? [];
    const byServer = new Map<string, string[]>();
    for (const tool of all) {
      const sep = tool.name.indexOf("__");
      if (sep > 0) {
        const server = tool.name.slice(0, sep);
        const toolName = tool.name.slice(sep + 2);
        if (!byServer.has(server)) byServer.set(server, []);
        byServer.get(server)!.push(toolName);
      }
    }

    const lines: string[] = [];
    const mcpStatus = (app["mcpStatus"] as McpStatus[] | undefined) ?? [];

    if (mcpStatus.length === 0 && byServer.size === 0) {
      return {
        type: "text",
        value: "No MCP servers configured.\n\nAdd servers in .atlas/settings.json under \"mcpServers\".",
      };
    }

    for (const entry of mcpStatus) {
      if (entry.status === "connected") {
        lines.push(`● ${entry.name}  (${entry.toolCount} tools)  ✓ connected`);
        const tools = byServer.get(entry.name) ?? [];
        for (const t of tools) lines.push(`    ${t}`);
      } else {
        lines.push(`✗ ${entry.name}  — failed to connect`);
        lines.push(`    command: ${entry.command}`);
        if (entry.error) lines.push(`    error: ${entry.error}`);
        lines.push(`    → If glibc mismatch: run  make build-mcp`);
        lines.push(`    → If command not found: run  make install-mcp`);
      }
    }

    for (const [server, tools] of byServer) {
      if (!mcpStatus.find(e => e.name === server)) {
        lines.push(`● ${server}  (${tools.length} tools)`);
        for (const t of tools) lines.push(`    ${t}`);
      }
    }

    return { type: "text", value: lines.join("\n") };
  },
};
