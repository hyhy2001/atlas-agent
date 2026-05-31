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
  const seeds = isBunVfs
    ? [dirname(resolve(exe))]
    : [dirname(resolve(exe)), dirname(resolve(script))];

  // Walk up from each seed looking for .atlas/settings.json. This handles
  // the wrapper-script case where argv[1] = "<install>/dist/cli.js" — we
  // need to climb out of dist/ to find <install>/.atlas/settings.json.
  // Stop at filesystem root.
  for (const seed of seeds) {
    let dir = seed;
    for (let i = 0; i < 10; i++) {
      if (existsSync(join(dir, ".atlas", "settings.json"))) {
        return dir;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
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
 * Used for: per-project sessions, telemetry, memory.
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
  // Cache lives in install dir — codebase-memory-mcp stores per-project
  // .db files (keyed by project path) so a single shared cache is fine.
  // Putting it install-side keeps the install fully self-contained:
  // no atlas-related state is written to user project dirs.
  cache:      () => join(atlasRoot(), ".atlas", "cache"),

  // Project-level (per-project, based on cwd)
  project:    () => projectRoot(),
  projectAtlas: () => join(projectRoot(), ".atlas"),
  sessions:   () => join(projectRoot(), ".atlas", "sessions"),
  telemetry:  () => join(projectRoot(), ".atlas", "telemetry"),
  memory:     () => join(projectRoot(), ".atlas", "memory"),
};
