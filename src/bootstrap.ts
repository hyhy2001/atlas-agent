import { existsSync, mkdirSync, writeFileSync, createReadStream } from "node:fs";
import { join, dirname, resolve } from "node:path";
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
  return new Promise(res => {
    // Use /dev/tty so the prompt works even when stdin is piped
    // (e.g. atlas-agent -p "..." < /dev/null). Fall back to stdin
    // on platforms without /dev/tty (Windows).
    let input: NodeJS.ReadableStream = process.stdin;
    if (process.platform !== "win32") {
      try { input = createReadStream("/dev/tty"); } catch { /* fallback to stdin */ }
    }
    const rl = createInterface({ input, output: process.stdout, terminal: true });
    rl.question(question, answer => {
      rl.close();
      if (input !== process.stdin) (input as { destroy?: () => void }).destroy?.();
      res(answer.trim());
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
  const cwd = process.cwd();

  // Already configured at the binary's install location or cwd — nothing to do.
  if (binaryDir && atlasExistsAt(binaryDir)) return;
  if (atlasExistsAt(cwd)) return;

  // Not a binary run (dev mode) — skip
  if (!binaryDir) return;

  // No TTY available (CI, piped, headless) — auto-create at cwd silently.
  if (!process.stdout.isTTY) {
    createAtlasDir(cwd);
    console.log(`Atlas: created .atlas/ at ${join(cwd, ".atlas")} (edit settings.json to configure)`);
    return;
  }

  // First run — ask user
  console.log("\n╭─── Atlas — First Run Setup ───────────────────────────────╮");
  console.log("│                                                            │");
  console.log("│  No .atlas/ configuration found.                          │");
  console.log("│  Where should Atlas store its settings?                   │");
  console.log("│                                                            │");
  console.log(`│  [1] Current Dir                                           │`);
  console.log(`│      ${cwd.slice(0, 52).padEnd(52)}  │`);
  console.log("│                                                            │");
  console.log(`│  [2] Other Dir  (you will be prompted for a path)         │`);
  console.log("│                                                            │");
  console.log("╰────────────────────────────────────────────────────────────╯\n");

  const answer = await prompt("Choose [1] current dir (default) or [2] other dir: ");

  let targetDir = cwd;
  if (answer === "2") {
    const customPath = await prompt("Enter directory path: ");
    targetDir = resolve(customPath.trim() || cwd);
  }

  createAtlasDir(targetDir);

  console.log(`\n✓ Created .atlas/ at: ${join(targetDir, ".atlas")}`);
  console.log("  Edit .atlas/settings.json to set your API base URL and token.\n");
}
