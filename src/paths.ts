import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

/**
 * Install directory — where the binary lives.
 * Used for: global settings, MCP binaries, default commands/agents.
 */
export function getAtlasRoot(): string {
  // Explicit override — highest priority.
  if (process.env["ATLAS_ROOT"]) {
    return process.env["ATLAS_ROOT"];
  }

  const exe = process.execPath;
  const script = process.argv[1] ?? "";

  // Bun compiled binary: argv[1] = "/$bunfs/..." (virtual FS), use execPath only.
  // Otherwise check both execPath dir and script dir.
  const isBunVfs = script.startsWith("/$bunfs/");
  const candidates = isBunVfs
    ? [dirname(resolve(exe))]
    : [dirname(resolve(exe)), dirname(resolve(script))];

  for (const dir of candidates) {
    if (existsSync(join(dir, ".atlas", "settings.json"))) {
      return dir;
    }
  }

  const cwd = process.cwd();
  const scriptPath = script ? resolve(script) : "";
  const isDevCli = scriptPath.endsWith(join("dist", "cli.js")) || scriptPath.endsWith(join("src", "cli.ts"));
  if (isDevCli && existsSync(join(cwd, "package.json"))) {
    return cwd;
  }

  return join(homedir(), ".atlas-agent");
}

/**
 * Project directory — where user invoked atlas-agent.
 * Used for: per-project sessions, telemetry, memory, cache.
 */
export function getProjectRoot(): string {
  return process.cwd();
}

let _atlasRoot: string | null = null;
let _projectRoot: string | null = null;

export function atlasRoot(): string {
  if (!_atlasRoot) _atlasRoot = getAtlasRoot();
  return _atlasRoot;
}

export function projectRoot(): string {
  if (!_projectRoot) _projectRoot = getProjectRoot();
  return _projectRoot;
}

export const paths = {
  // Install-level (shared across all projects)
  root:       () => atlasRoot(),
  atlas:      () => join(atlasRoot(), ".atlas"),
  config:     () => join(atlasRoot(), ".atlas", "settings.json"),
  bin:        () => join(atlasRoot(), ".atlas", "bin"),
  commands:   () => join(atlasRoot(), ".atlas", "commands"),
  agents:     () => join(atlasRoot(), ".atlas", "agents"),
  skills:     () => join(atlasRoot(), ".atlas", "skills"),

  // Project-level (per-project, based on cwd)
  project:    () => projectRoot(),
  projectAtlas: () => join(projectRoot(), ".atlas"),
  sessions:   () => join(projectRoot(), ".atlas", "sessions"),
  telemetry:  () => join(projectRoot(), ".atlas", "telemetry"),
  cache:      () => join(projectRoot(), ".atlas", "cache"),
  memory:     () => join(projectRoot(), ".atlas", "memory"),
};
