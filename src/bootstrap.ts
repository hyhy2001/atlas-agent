import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

const SETTINGS_TEMPLATE = JSON.stringify({
  model: "all",
  baseURL: "",
  authToken: "",
  mcpServers: [
    { name: "codebase-memory", command: "./.atlas/bin/codebase-memory-mcp", args: [], autoApprove: true }
  ]
}, null, 2);

function atlasExistsAt(dir: string): boolean {
  return existsSync(join(dir, ".atlas", "settings.json"));
}

function createAtlasDir(dir: string): void {
  const atlasDir = join(dir, ".atlas");
  mkdirSync(join(atlasDir, "agents"), { recursive: true });
  mkdirSync(join(atlasDir, "commands"), { recursive: true });
  mkdirSync(join(atlasDir, "skills"), { recursive: true });
  mkdirSync(join(atlasDir, "bin"), { recursive: true });
  const settingsPath = join(atlasDir, "settings.json");
  if (!existsSync(settingsPath)) {
    writeFileSync(settingsPath, SETTINGS_TEMPLATE, "utf-8");
  }
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function getBinaryDir(): string | null {
  const script = process.argv[1];
  if (!script) return null;
  const scriptPath = resolve(script);
  // Detect dev mode — don't bootstrap in dev
  if (scriptPath.endsWith(join("dist", "cli.js")) || scriptPath.endsWith(join("src", "cli.ts"))) {
    return null;
  }
  // Bun compiled binary: execPath is the binary itself
  const exeDir = dirname(resolve(process.execPath));
  const scriptDir = dirname(scriptPath);
  // Prefer the directory that actually contains the binary
  return exeDir !== process.cwd() ? exeDir : scriptDir;
}

/**
 * First-run bootstrap: if no .atlas/ is found anywhere, ask the user where
 * to create it. Called once at startup before any config is loaded.
 *
 * Returns the chosen root dir (or null if skipped / already exists).
 */
export async function maybeBootstrap(): Promise<void> {
  const binaryDir = getBinaryDir();
  const homeDir = join(homedir(), ".atlas-agent");

  // Already configured at the binary's install location or in home — nothing
  // to do. We do NOT check cwd: a project-local .atlas/ holds sessions/memory
  // for that project, not the install-level settings the bootstrap creates.
  if (binaryDir && atlasExistsAt(binaryDir)) return;
  if (atlasExistsAt(homeDir)) return;

  // Not a binary run (dev mode) — skip
  if (!binaryDir) return;

  // First run — ask user
  console.log("\n╭─── Atlas — First Run Setup ───────────────────────────────╮");
  console.log("│                                                            │");
  console.log("│  No .atlas/ configuration found.                          │");
  console.log("│  Where should Atlas store its settings?                   │");
  console.log("│                                                            │");
  console.log(`│  [1] Portable  — next to this binary                      │`);
  console.log(`│      ${binaryDir.slice(0, 52).padEnd(52)}  │`);
  console.log("│                                                            │");
  console.log(`│  [2] Global    — your home directory                      │`);
  console.log(`│      ${homeDir.slice(0, 52).padEnd(52)}  │`);
  console.log("│                                                            │");
  console.log("╰────────────────────────────────────────────────────────────╯\n");

  const answer = await prompt("Choose [1] portable (default) or [2] global: ");
  const useHome = answer === "2";
  const targetDir = useHome ? homeDir : binaryDir;

  createAtlasDir(targetDir);

  console.log(`\n✓ Created .atlas/ at: ${join(targetDir, ".atlas")}`);
  console.log("  Edit .atlas/settings.json to set your API base URL and token.\n");
}
