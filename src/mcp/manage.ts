import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { getPortableRoot } from "../config.js";

export interface McpServerEntry {
  name: string;
  command: string;
  args: string[];
  autoApprove: boolean;
}

function getSettingsPath(): string {
  const portable = getPortableRoot();
  if (portable) return join(portable, "config", "settings.json");
  return join(homedir(), ".config", "atlas-agent", "settings.json");
}

async function loadSettings(): Promise<{ mcpServers: McpServerEntry[]; [key: string]: unknown }> {
  const path = getSettingsPath();
  if (!existsSync(path)) return { mcpServers: [] };
  try {
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.mcpServers)) parsed.mcpServers = [];
    return parsed;
  } catch {
    return { mcpServers: [] };
  }
}

async function saveSettings(settings: { mcpServers: McpServerEntry[]; [key: string]: unknown }): Promise<void> {
  const path = getSettingsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

export async function listMcpServers(): Promise<void> {
  const settings = await loadSettings();
  if (settings.mcpServers.length === 0) {
    console.log("No MCP servers configured.");
    return;
  }
  console.log(`MCP servers in ${getSettingsPath()}:\n`);
  for (const s of settings.mcpServers) {
    console.log(`  ${s.name}`);
    console.log(`    command: ${s.command} ${s.args.join(" ")}`);
    console.log(`    autoApprove: ${s.autoApprove}`);
    console.log("");
  }
}

export async function addMcpServer(name: string, command: string, args: string[]): Promise<void> {
  const settings = await loadSettings();
  if (settings.mcpServers.find(s => s.name === name)) {
    console.error(`Error: server '${name}' already exists. Remove it first or use a different name.`);
    process.exit(1);
  }
  settings.mcpServers.push({ name, command, args, autoApprove: true });
  await saveSettings(settings);
  console.log(`Added MCP server '${name}': ${command} ${args.join(" ")}`);
}

export async function removeMcpServer(name: string): Promise<void> {
  const settings = await loadSettings();
  const before = settings.mcpServers.length;
  settings.mcpServers = settings.mcpServers.filter(s => s.name !== name);
  if (settings.mcpServers.length === before) {
    console.error(`Error: server '${name}' not found.`);
    process.exit(1);
  }
  await saveSettings(settings);
  console.log(`Removed MCP server '${name}'`);
}
