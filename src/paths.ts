import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

export function getAtlasRoot(): string {
  const exe = process.execPath;
  const script = process.argv[1];

  // Check portable: .atlas/settings.json next to binary or script
  const candidates = [
    dirname(resolve(exe)),
    dirname(resolve(script || "")),
  ];

  for (const dir of candidates) {
    if (existsSync(join(dir, ".atlas", "settings.json"))) {
      return dir;
    }
  }

  // Dev mode: cwd has package.json (we're in the project)
  const cwd = process.cwd();
  const scriptPath = script ? resolve(script) : "";
  const isDevCli = scriptPath.endsWith(join("dist", "cli.js")) || scriptPath.endsWith(join("src", "cli.ts"));
  if (isDevCli && existsSync(join(cwd, "package.json"))) {
    return cwd;
  }

  // Fallback: home dir
  return join(homedir(), ".atlas-agent");
}

let _root: string | null = null;
export function atlasRoot(): string {
  if (!_root) _root = getAtlasRoot();
  return _root;
}

// All paths under .atlas/
export const paths = {
  root:       () => atlasRoot(),
  atlas:      () => join(atlasRoot(), ".atlas"),
  config:     () => join(atlasRoot(), ".atlas", "settings.json"),
  sessions:   () => join(atlasRoot(), ".atlas", "sessions"),
  telemetry:  () => join(atlasRoot(), ".atlas", "telemetry"),
  cache:      () => join(atlasRoot(), ".atlas", "cache"),
  memory:     () => join(atlasRoot(), ".atlas", "memory"),
  commands:   () => join(atlasRoot(), ".atlas", "commands"),
  agents:     () => join(atlasRoot(), ".atlas", "agents"),
  bin:        () => join(atlasRoot(), ".atlas", "bin"),
};
