import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const McpServerSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  autoApprove: z.boolean().default(false),
});

const ConfigSchema = z.object({
  model: z.string().default("claude-sonnet-4-20250514"),
  subagentModel: z.string().optional(),
  baseURL: z.string().optional(),
  authToken: z.string().optional(),
  systemPrompt: z.string().optional(),
  mcpServers: z.array(McpServerSchema).default([
    { name: "codebase-memory", command: "codebase-memory-mcp", args: [], autoApprove: true },
  ]),
});

export type Config = z.infer<typeof ConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerSchema>;

function loadJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function loadConfig(overrides?: Partial<Config>): Config {
  const globalPath = join(homedir(), ".config", "atlas-agent", "config.json");
  const localPath = join(process.cwd(), ".atlas-agent.json");

  const globalConfig = loadJsonFile(globalPath);
  const localConfig = loadJsonFile(localPath);

  const merged = { ...globalConfig, ...localConfig };

  if (process.env["ATLAS_BASE_URL"]) {
    merged.baseURL = process.env["ATLAS_BASE_URL"];
  }
  if (process.env["ATLAS_AUTH_TOKEN"]) {
    merged.authToken = process.env["ATLAS_AUTH_TOKEN"];
  }
  if (process.env["ATLAS_MODEL"]) {
    merged.model = process.env["ATLAS_MODEL"];
  }

  if (process.env["ATLAS_SUBAGENT_MODEL"]) {
    merged.subagentModel = process.env["ATLAS_SUBAGENT_MODEL"];
  }

  // Allow overriding system prompt via environment variable
  if (process.env["ATLAS_SYSTEM_PROMPT"]) {
    merged.systemPrompt = process.env["ATLAS_SYSTEM_PROMPT"];
  }

  if (overrides) {
    Object.assign(merged, overrides);
  }

  return ConfigSchema.parse(merged);
}
