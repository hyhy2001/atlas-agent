import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join, isAbsolute, dirname, resolve } from "node:path";
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
  theme: z.enum(["dark", "light", "monokai", "solarized"]).default("dark"),
  trustedDirs: z.array(z.string()).default([]),
  mcpServers: z.array(McpServerSchema).default([]),
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
  const root = atlasRoot();
  // Also try the directory containing the actual binary (for portable installs)
  const exeDir = dirname(resolve(process.execPath));
  const scriptDir = process.argv[1] ? dirname(resolve(process.argv[1])) : null;

  return servers.map((s) => {
    if (!isAbsolute(s.command)) {
      const rel = s.command.replace(/^\.\//, "");
      // Try candidates in priority order
      const candidates = [
        join(root, rel),           // atlasRoot (home or binary dir)
        join(exeDir, rel),         // dir of the actual binary
        scriptDir ? join(scriptDir, rel) : null,  // dir of the script
        join(binDir, s.command),   // bare filename in binDir
      ].filter(Boolean) as string[];

      for (const c of candidates) {
        if (existsSync(c)) return { ...s, command: c };
        if (process.platform === "win32" && existsSync(c + ".exe")) {
          return { ...s, command: c + ".exe" };
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

  // If no mcpServers configured, inject the default codebase-memory server
  // only when the binary actually exists at paths.bin() — avoids injecting
  // a path that doesn't exist and causing a confusing "not found" warning.
  let mcpServers = config.mcpServers;
  if (mcpServers.length === 0) {
    const defaultMcp = join(paths.bin(), "codebase-memory-mcp");
    const defaultMcpWin = defaultMcp + ".exe";
    if (existsSync(defaultMcp) || existsSync(defaultMcpWin)) {
      mcpServers = [{ name: "codebase-memory", command: defaultMcp, args: [], autoApprove: true }];
    }
  }

  const resolved = resolveMcpCommands(mcpServers, atlasRoot());
  return { ...config, mcpServers: resolved };
}
