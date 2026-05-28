import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";

const McpServerSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  autoApprove: z.boolean().default(false),
});

const ConfigSchema = z.object({
  model: z.string().default("all"),
  subagentModel: z.string().optional(),
  mechModel: z.string().optional(),
  coderModel: z.string().optional(),
  rescueModel: z.string().optional(),
  baseURL: z.string().optional(),
  authToken: z.string().optional(),
  systemPrompt: z.string().optional(),
  mcpServers: z.array(McpServerSchema).default([
    { name: "codebase-memory", command: "codebase-memory-mcp", args: [], autoApprove: true },
  ]),
});

export type Config = z.infer<typeof ConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerSchema>;

function getPortableDir(): string | null {
  const exe = process.argv[1];
  if (!exe) return null;
  const dir = dirname(resolve(exe));
  if (existsSync(join(dir, "config", "config.json")) || existsSync(join(dir, "bin"))) {
    return dir;
  }
  return null;
}

export function getPortableRoot(): string | null {
  return getPortableDir();
}

function loadJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function resolveMcpCommands(
  servers: Array<{ name: string; command: string; args: string[]; autoApprove: boolean }>,
  portableDir: string
): Array<{ name: string; command: string; args: string[]; autoApprove: boolean }> {
  const binDir = join(portableDir, "bin");
  return servers.map((s) => {
    if (!isAbsolute(s.command)) {
      const candidate = join(binDir, s.command);
      if (existsSync(candidate)) {
        return { ...s, command: candidate };
      }
    }
    return s;
  });
}

export function loadConfig(overrides?: Partial<Config>): Config {
  const globalPath = join(homedir(), ".config", "atlas-agent", "config.json");
  const localPath = join(process.cwd(), ".atlas-agent.json");

  const portableDir = getPortableDir();
  const portablePath = portableDir ? join(portableDir, "config", "config.json") : null;

  const globalConfig = loadJsonFile(globalPath);
  const portableConfig = portablePath ? loadJsonFile(portablePath) : {};
  const localConfig = loadJsonFile(localPath);

  // Layered merge: global < portable < local
  const merged = { ...globalConfig, ...portableConfig, ...localConfig };

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
  if (process.env["ATLAS_MECH_MODEL"]) merged.mechModel = process.env["ATLAS_MECH_MODEL"];
  if (process.env["ATLAS_CODER_MODEL"]) merged.coderModel = process.env["ATLAS_CODER_MODEL"];
  if (process.env["ATLAS_RESCUE_MODEL"]) merged.rescueModel = process.env["ATLAS_RESCUE_MODEL"];

  if (process.env["ATLAS_SYSTEM_PROMPT"]) {
    merged.systemPrompt = process.env["ATLAS_SYSTEM_PROMPT"];
  }

  if (overrides) {
    Object.assign(merged, overrides);
  }

  const config = ConfigSchema.parse(merged);

  // Resolve relative MCP commands against portable bin/ dir
  if (portableDir) {
    const resolved = resolveMcpCommands(config.mcpServers, portableDir);
    return { ...config, mcpServers: resolved };
  }

  return config;
}
