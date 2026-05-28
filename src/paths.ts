import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

export function getAtlasRoot(): string {
  const exe = process.execPath;
  const script = process.argv[1];

  const isBunBinary = !exe.includes("node") && !exe.includes("bun") && existsSync(exe);

  const candidates = [
    dirname(resolve(exe)),
    dirname(resolve(script || "")),
  ];

  for (const dir of candidates) {
    if (existsSync(join(dir, "config", "settings.json"))) {
      return dir;
    }
  }

  const cwd = process.cwd();
  const scriptPath = script ? resolve(script) : "";
  const isDevCli = scriptPath.endsWith(join("dist", "cli.js")) || scriptPath.endsWith(join("src", "cli.ts"));
  if (isDevCli && existsSync(join(cwd, "package.json"))) {
    return cwd;
  }

  return join(homedir(), ".config", "atlas-agent");
}

let _root: string | null = null;
export function atlasRoot(): string {
  if (!_root) _root = getAtlasRoot();
  return _root;
}

export const paths = {
  root:      () => atlasRoot(),
  config:    () => join(atlasRoot(), "config", "settings.json"),
  sessions:  () => join(atlasRoot(), "sessions"),
  telemetry: () => join(atlasRoot(), "telemetry"),
  cache:     () => join(atlasRoot(), "cache"),
  memory:    () => join(atlasRoot(), ".atlas", "memory"),
  hooks:     () => join(atlasRoot(), ".atlas", "settings.json"),
  commands:  () => join(atlasRoot(), ".atlas", "commands"),
  agents:    () => join(atlasRoot(), ".atlas", "agents"),
  bin:       () => join(atlasRoot(), "bin"),
};
