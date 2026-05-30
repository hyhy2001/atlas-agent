import { promisify } from "node:util";
import { exec } from "node:child_process";
import { existsSync, mkdirSync, chmodSync, createWriteStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import which from "which";
import { paths } from "../paths.js";

const execAsync = promisify(exec);

function lspDir(): string {
  return path.join(paths.bin(), "lsp");
}

function rustTargetTriple(): string {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "linux" && arch === "x64") return "x86_64-unknown-linux-gnu";
  if (platform === "linux" && arch === "arm64") return "aarch64-unknown-linux-gnu";
  if (platform === "darwin" && arch === "x64") return "x86_64-apple-darwin";
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin";
  if (platform === "win32" && arch === "x64") return "x86_64-pc-windows-msvc";
  if (platform === "win32" && arch === "arm64") return "aarch64-pc-windows-msvc";
  throw new Error(`Unsupported platform/arch for rust-analyzer: ${platform}/${arch}`);
}

interface GithubReleaseAsset {
  name: string;
  url: string;             // download url template, with {triple} placeholder
  archive?: "gz";          // unwrap if gzipped
  binaryName: string;      // final binary name placed under lspDir
}

export interface ServerConfig {
  language: string;
  extensions: string[];
  command: string;
  args: string[];
  installType?: "npm" | "pip" | "github-release";
  npmPackages?: string[];
  pipPackage?: string;
  githubRepo?: string;
  githubAsset?: string;
  githubArchive?: "gz";
  installHint?: string;
  rootMarkers: string[];
}

export const SERVERS: ServerConfig[] = [
  {
    language: "typescript",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    command: "typescript-language-server",
    args: ["--stdio"],
    installType: "npm",
    npmPackages: ["typescript-language-server", "typescript"],
    rootMarkers: ["tsconfig.json", "package.json", ".git"],
  },
  {
    language: "javascript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    command: "typescript-language-server",
    args: ["--stdio"],
    installType: "npm",
    npmPackages: ["typescript-language-server", "typescript"],
    rootMarkers: ["package.json", ".git"],
  },
  {
    language: "python",
    extensions: [".py", ".pyi"],
    command: "pylsp",
    args: [],
    installType: "pip",
    pipPackage: "python-lsp-server",
    rootMarkers: ["pyproject.toml", "setup.py", ".git"],
  },
  {
    language: "c",
    extensions: [".c", ".h"],
    command: "clangd",
    args: [],
    installHint: "Install clangd: apt install clangd (Ubuntu/Debian) or brew install llvm (macOS)",
    rootMarkers: ["compile_commands.json", ".git"],
  },
  {
    language: "cpp",
    extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh"],
    command: "clangd",
    args: [],
    installHint: "Install clangd: apt install clangd (Ubuntu/Debian) or brew install llvm (macOS)",
    rootMarkers: ["compile_commands.json", ".git"],
  },
  {
    language: "verilog",
    extensions: [".v", ".sv", ".svh"],
    command: "verible-verilog-ls",
    args: [],
    installHint: "Install verible-verilog-ls from https://github.com/chipsalliance/verible/releases",
    rootMarkers: [".git"],
  },
  {
    language: "rust",
    extensions: [".rs"],
    command: "rust-analyzer",
    args: [],
    installType: "github-release",
    githubRepo: "rust-lang/rust-analyzer",
    githubAsset: "rust-analyzer-{triple}.gz",
    githubArchive: "gz",
    installHint: "Install rust-analyzer from https://github.com/rust-lang/rust-analyzer/releases or via rustup component add rust-analyzer",
    rootMarkers: ["Cargo.toml", ".git"],
  },
  {
    language: "yaml",
    extensions: [".yaml", ".yml"],
    command: "yaml-language-server",
    args: ["--stdio"],
    installType: "npm",
    npmPackages: ["yaml-language-server"],
    rootMarkers: [".git"],
  },
  {
    language: "json",
    extensions: [".json", ".jsonc"],
    command: "vscode-json-language-server",
    args: ["--stdio"],
    installType: "npm",
    npmPackages: ["vscode-langservers-extracted"],
    rootMarkers: [".git"],
  },
];

export function serverForFile(filePath: string): ServerConfig | null {
  const ext = path.extname(filePath).toLowerCase();
  return SERVERS.find(s => s.extensions.includes(ext)) ?? null;
}

export function findProjectRoot(filePath: string, markers: string[]): string {
  let dir = path.dirname(path.resolve(filePath));
  while (true) {
    for (const m of markers) {
      if (existsSync(path.join(dir, m))) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.dirname(path.resolve(filePath));
    dir = parent;
  }
}

export async function resolveServerCommand(cfg: ServerConfig): Promise<string | null> {
  const dir = lspDir();
  const npmLocal = path.join(dir, "node_modules", ".bin", cfg.command);
  if (existsSync(npmLocal)) return npmLocal;
  const pipLocal = path.join(dir, "pyvenv", "bin", cfg.command);
  if (existsSync(pipLocal)) return pipLocal;
  // github-release binaries are placed directly under lspDir
  const ghLocal = path.join(dir, cfg.command);
  if (existsSync(ghLocal)) return ghLocal;
  // Only fall back to a globally-installed binary for servers we cannot
  // auto-install into the atlas dir (clangd, verible). Auto-installable
  // servers (npm/pip/github-release) must live in the atlas install dir —
  // never resolve them from a global location.
  if (!cfg.installType) {
    try {
      return await which(cfg.command);
    } catch {
      return null;
    }
  }
  return null;
}

interface GithubReleaseInfo {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

async function downloadGithubRelease(cfg: ServerConfig, dir: string): Promise<string> {
  if (!cfg.githubRepo || !cfg.githubAsset) {
    throw new Error("github-release config missing githubRepo/githubAsset");
  }
  const triple = rustTargetTriple();
  const assetName = cfg.githubAsset.replace("{triple}", triple);

  // Fetch latest release metadata
  const apiUrl = `https://api.github.com/repos/${cfg.githubRepo}/releases/latest`;
  const res = await fetch(apiUrl, { headers: { "User-Agent": "atlas-agent", Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${apiUrl}`);
  const info = (await res.json()) as GithubReleaseInfo;
  const asset = info.assets.find(a => a.name === assetName);
  if (!asset) throw new Error(`Asset ${assetName} not found in ${cfg.githubRepo} ${info.tag_name}`);

  // Download the asset
  const dlRes = await fetch(asset.browser_download_url, { headers: { "User-Agent": "atlas-agent" } });
  if (!dlRes.ok || !dlRes.body) throw new Error(`Download failed: ${dlRes.status}`);

  const binPath = path.join(dir, cfg.command);
  const { Readable } = await import("node:stream");
  const nodeStream = Readable.fromWeb(dlRes.body as Parameters<typeof Readable.fromWeb>[0]);

  if (cfg.githubArchive === "gz") {
    await pipeline(nodeStream, createGunzip(), createWriteStream(binPath));
  } else {
    await pipeline(nodeStream, createWriteStream(binPath));
  }
  chmodSync(binPath, 0o755);
  return binPath;
}

export interface InstallResult { ok: boolean; command?: string; installed?: boolean; error?: string }

export async function ensureServerInstalled(cfg: ServerConfig): Promise<InstallResult> {
  const existing = await resolveServerCommand(cfg);
  if (existing) return { ok: true, command: existing, installed: false };

  if (!cfg.installType) {
    return { ok: false, error: cfg.installHint ?? `${cfg.command} not found and no auto-install available` };
  }

  const dir = lspDir();
  try {
    mkdirSync(dir, { recursive: true });
    if (cfg.installType === "npm") {
      const pkgs = (cfg.npmPackages ?? []).join(" ");
      await execAsync(`npm install --prefix "${dir}" ${pkgs}`, { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
    } else if (cfg.installType === "pip") {
      const venv = path.join(dir, "pyvenv");
      if (!existsSync(path.join(venv, "bin", "pip"))) {
        await execAsync(`python3 -m venv "${venv}"`, { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
      }
      await execAsync(`"${path.join(venv, "bin", "pip")}" install ${cfg.pipPackage}`, { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
    } else if (cfg.installType === "github-release") {
      await downloadGithubRelease(cfg, dir);
    }
    const resolved = await resolveServerCommand(cfg);
    if (!resolved) {
      return { ok: false, error: `Installed ${cfg.command} but binary not found in ${dir}` };
    }
    return { ok: true, command: resolved, installed: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    let manualCmd: string;
    if (cfg.installType === "npm") {
      manualCmd = `npm install --prefix "${dir}" ${(cfg.npmPackages ?? []).join(" ")}`;
    } else if (cfg.installType === "pip") {
      manualCmd = `python3 -m venv "${path.join(dir, "pyvenv")}" && "${path.join(dir, "pyvenv", "bin", "pip")}" install ${cfg.pipPackage}`;
    } else {
      manualCmd = cfg.installHint ?? `Install ${cfg.command} manually`;
    }
    return { ok: false, error: `Failed to install ${cfg.command}: ${msg}\nTry manually: ${manualCmd}` };
  }
}
