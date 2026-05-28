#!/usr/bin/env node
// build-all.mjs — build binaries for all 5 platforms
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const TARGETS = [
  { key: "linux-x64",    target: "bun-linux-x64",    ext: "" },
  { key: "linux-arm64",  target: "bun-linux-arm64",  ext: "" },
  { key: "darwin-arm64", target: "bun-darwin-arm64", ext: "" },
  { key: "darwin-x64",   target: "bun-darwin-x64",   ext: "" },
  { key: "windows-x64",  target: "bun-windows-x64",  ext: ".exe" },
];

mkdirSync("release", { recursive: true });

let built = 0;
for (const { key, target, ext } of TARGETS) {
  const outFile = `release/atlas-agent-${key}${ext}`;
  process.stdout.write(`Building ${key}... `);

  const r = spawnSync(
    "bun",
    ["build", "--compile", "--minify", `--target=${target}`, "./src/cli.ts", `--outfile=${outFile}`],
    { stdio: "pipe" }
  );

  if (r.status === 0) {
    console.log("OK");
    built++;
  } else {
    console.log("SKIP (cross-compile not available)");
  }
}

console.log(`\nBuilt ${built}/${TARGETS.length} binaries in release/`);
