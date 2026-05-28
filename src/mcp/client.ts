import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";
import which from "which";
import type { McpServerConfig } from "./types.js";
import type { ToolDefinition, ToolResult, ExecutionContext } from "../tools/types.js";
import { getPortableRoot } from "../config.js";

export class McpClient {
  private client: Client;
  private transport: StdioClientTransport;
  private toolList: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> = [];
  private autoApprove: boolean;
  private serverName: string;

  private constructor(
    client: Client,
    transport: StdioClientTransport,
    config: McpServerConfig
  ) {
    this.client = client;
    this.transport = transport;
    this.autoApprove = config.autoApprove;
    this.serverName = config.name;
  }

  static async create(config: McpServerConfig): Promise<McpClient | null> {
    try {
      const resolved = await which(config.command).catch(() => null);
      if (!resolved) {
        console.warn(`MCP server "${config.name}": command "${config.command}" not found, skipping`);
        return null;
      }

      const portableRoot = getPortableRoot();
      const env =
        portableRoot && config.name === "codebase-memory"
          ? { ...process.env, CBM_CACHE_DIR: join(portableRoot, "cache") } as Record<string, string>
          : undefined;

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        stderr: "pipe",
        env,
      });

      const client = new Client({
        name: "atlas-agent",
        version: "0.1.0",
      });

      const connectPromise = client.connect(transport);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Connection timeout")), 5000)
      );

      await Promise.race([connectPromise, timeoutPromise]);

      const mcpClient = new McpClient(client, transport, config);

      const result = await client.listTools();
      mcpClient.toolList = (result.tools || []).map((t) => ({
        name: t.name,
        description: t.description || "",
        inputSchema: (t.inputSchema || {}) as Record<string, unknown>,
      }));

      return mcpClient;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`MCP server "${config.name}" failed to connect: ${msg}`);
      return null;
    }
  }

  getTools(): ToolDefinition[] {
    return this.toolList.map((tool) => ({
      name: `${this.serverName}__${tool.name}`,
      description: tool.description,
      inputSchema: tool.inputSchema,
      isDestructive: !this.autoApprove,
      execute: async (_input: unknown, _ctx: ExecutionContext): Promise<ToolResult> => {
        const content = await this.callTool(tool.name, _input);
        return { toolUseId: "", content, isError: false };
      },
    }));
  }

  async callTool(name: string, args: unknown): Promise<string> {
    const result = await this.client.callTool({
      name,
      arguments: args as Record<string, unknown>,
    });
    if (result.content && Array.isArray(result.content)) {
      return result.content
        .map((c) => {
          if (typeof c === "object" && c !== null && "text" in c) {
            return (c as { text: string }).text;
          }
          return JSON.stringify(c);
        })
        .join("\n");
    }
    return JSON.stringify(result);
  }

  async close(): Promise<void> {
    try {
      await this.transport.close();
    } catch {
      // ignore close errors
    }
  }
}
