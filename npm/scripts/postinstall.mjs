import { createWriteStream, mkdirSync, chmodSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = dirname(__dirname);
const binDir = join(pkgRoot, "bin");

const BASE_URL = process.env.ATLAS_INSTALL_URL || "https://artifacts.company.local/atlas-agent";
const VERSION = process.env.ATLAS_VERSION || "latest";

function getPlatform() {
  const os = process.platform;
  const arch = process.arch;

  let platform;
  switch (os) {
    case "linux": platform = "linux"; break;
    case "darwin": platform = "darwin"; break;
    case "win32": platform = "windows"; break;
    default: throw new Error(`Unsupported OS: ${os}`);
  }

  let archName;
  switch (arch) {
    case "x64": archName = "x64"; break;
    case "arm64": archName = "arm64"; break;
    default: throw new Error(`Unsupported arch: ${arch}`);
  }

  return { platform, archName };
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const fileStream = createWriteStream(dest);
  await pipeline(res.body, fileStream);
}

async function main() {
  const { platform, archName } = getPlatform();
  const ext = platform === "windows" ? ".exe" : "";
  const binaryName = `atlas-agent${ext}`;
  const binaryPath = join(binDir, binaryName);

  if (existsSync(binaryPath)) {
    console.log("atlas-agent already installed.");
    return;
  }

  const asset = VERSION === "latest"
    ? `atlas-agent-latest-${platform}-${archName}.tar.gz`
    : `atlas-agent-v${VERSION}-${platform}-${archName}.tar.gz`;
  const url = `${BASE_URL}/${asset}`;

  console.log(`Downloading atlas-agent for ${platform}-${archName}...`);
  console.log(`  From: ${url}`);

  mkdirSync(binDir, { recursive: true });

  const tmpFile = join(binDir, `_download.tmp`);
  try {
    await download(url, tmpFile);
    execSync(`tar -xzf "${tmpFile}" -C "${binDir}" atlas-agent${ext}`, { stdio: "pipe" });
    unlinkSync(tmpFile);
    if (platform !== "windows") chmodSync(binaryPath, 0o755);
    console.log(`  Installed: ${binaryPath}`);
  } catch (err) {
    if (existsSync(tmpFile)) unlinkSync(tmpFile);
    console.error(`  Warning: download failed: ${err.message}`);
    console.error(`  Set ATLAS_INSTALL_URL or download manually from your artifact server.`);
    const stub = platform === "windows"
      ? `@echo off\r\necho atlas-agent binary not installed. Set ATLAS_INSTALL_URL and reinstall.\r\nexit /b 1\r\n`
      : `#!/bin/sh\necho "atlas-agent binary not installed. Set ATLAS_INSTALL_URL and reinstall."\nexit 1\n`;
    writeFileSync(binaryPath, stub);
    if (platform !== "windows") chmodSync(binaryPath, 0o755);
  }
}

main().catch((err) => {
  console.error(`postinstall failed: ${err.message}`);
  process.exit(0);
});
