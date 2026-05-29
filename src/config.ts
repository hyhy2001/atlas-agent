import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { paths, atlasRoot } from "./paths.js";

const McpServerSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  autoApprove: z.boolean().default(false),
});

const ConfigSchema = z.object({
  model: z.string().default("all"),
  fastModel: z.string().optional(),
  reasoningModel: z.string().optional(),
  baseURL: z.string().optional(),
  authToken: z.string().optional(),
  systemPrompt: z.string().optional(),
  trustedDirs: z.array(z.string()).default([]),
  mcpServers: z.array(McpServerSchema).default([
    { name: "codebase-memory", command: "codebase-memory-mcp", args: [], autoApprove: true },
  ]),
});

export type Config = z.infer<typeof ConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerSchema>;

export function getPortableRoot(): string | null {
  return atlasRoot();
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
  const binDir = paths.bin();
  return servers.map((s) => {
    if (!isAbsolute(s.command)) {
      const candidate = join(binDir, s.command);
      if (existsSync(candidate)) {
        return { ...s, command: candidate };
      }
      if (process.platform === "win32") {
        const withExe = candidate + ".exe";
        if (existsSync(withExe)) {
          return { ...s, command: withExe };
        }
      }
    }
    return s;
  });
}

export function loadConfig(overrides?: Partial<Config>): Config {
  const configPath = paths.config();
  const localPath = join(process.cwd(), ".atlas-agent.json");

  const mainConfig = loadJsonFile(configPath);
  const localConfig = loadJsonFile(localPath);

  // Merge: .atlas/settings.json < .atlas-agent.json (project override)
  const merged = { ...mainConfig, ...localConfig };

  if (process.env["ATLAS_BASE_URL"]) {
    merged.baseURL = process.env["ATLAS_BASE_URL"];
  }
  if (process.env["ATLAS_AUTH_TOKEN"]) {
    merged.authToken = process.env["ATLAS_AUTH_TOKEN"];
  }
  if (process.env["ATLAS_MODEL"]) {
    merged.model = process.env["ATLAS_MODEL"];
  }

  if (process.env["ATLAS_FAST_MODEL"]) merged.fastModel = process.env["ATLAS_FAST_MODEL"];
  if (process.env["ATLAS_REASONING_MODEL"]) merged.reasoningModel = process.env["ATLAS_REASONING_MODEL"];

  if (process.env["ATLAS_SYSTEM_PROMPT"]) {
    merged.systemPrompt = process.env["ATLAS_SYSTEM_PROMPT"];
  }
  if (overrides) {
    Object.assign(merged, overrides);
  }

  const config = ConfigSchema.parse(merged);

  const resolved = resolveMcpCommands(config.mcpServers, atlasRoot());
  return { ...config, mcpServers: resolved };

  return config;
}
