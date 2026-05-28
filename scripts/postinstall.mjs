#!/usr/bin/env node
// postinstall.mjs — runs after npm install, builds binary for current OS
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform, arch } from "node:process";

// Skip in CI or if SKIP_BINARY_BUILD is set
if (process.env.CI || process.env.SKIP_BINARY_BUILD) {
  console.log("Skipping binary build (CI or SKIP_BINARY_BUILD set).");
  process.exit(0);
}

// Check if bun is available
function hasBun() {
  const r = spawnSync("bun", ["--version"], { stdio: "pipe" });
  return r.status === 0;
}

function installBun() {
  console.log("Installing Bun...");
  if (platform === "win32") {
    execSync(
      `powershell -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"`,
      { stdio: "inherit" }
    );
  } else {
    execSync(`curl -fsSL https://bun.sh/install | bash`, { stdio: "inherit" });
    // Add bun to PATH for this process
    const bunBin = `${process.env.HOME}/.bun/bin`;
    process.env.PATH = `${bunBin}:${process.env.PATH}`;
  }
}

// Map Node platform/arch to Bun target
function getBunTarget() {
  const os = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
  const a = arch === "arm64" ? "arm64" : "x64";
  const targets = {
    "linux-x64":    "bun-linux-x64",
    "linux-arm64":  "bun-linux-arm64",
    "darwin-x64":   "bun-darwin-x64",
    "darwin-arm64": "bun-darwin-arm64",
    "windows-x64":  "bun-windows-x64",
  };
  const key = `${os}-${a}`;
  const target = targets[key];
  if (!target) throw new Error(`Unsupported platform: ${key}`);
  const ext = os === "windows" ? ".exe" : "";
  return { target, key, ext };
}

async function main() {
  console.log("atlas-agent: building binary for current platform...");

  if (!hasBun()) installBun();

  const { target, key, ext } = getBunTarget();
  const outFile = `release/atlas-agent-${key}${ext}`;

  console.log(`  Target: ${target}`);
  console.log(`  Output: ${outFile}`);

  const r = spawnSync(
    "bun",
    ["build", "--compile", "--minify", `--target=${target}`, "./src/cli.ts", `--outfile=${outFile}`],
    { stdio: "inherit" }
  );

  if (r.status !== 0) {
    console.error("Binary build failed. You can still use: npm run dev");
    process.exit(0); // don't fail npm install
  }

  console.log(`  Done: ${outFile}`);
  console.log("");
  console.log("Run: node dist/cli.js  (after npm run build)");
  console.log("Or:  npm run dev");
}

main().catch((err) => {
  console.error(`postinstall error: ${err.message}`);
  process.exit(0); // never fail npm install
});
