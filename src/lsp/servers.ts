import { promisify } from "node:util";
import { exec } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import which from "which";
import { paths } from "../paths.js";

const execAsync = promisify(exec);

function lspDir(): string {
  return path.join(paths.bin(), "lsp");
}

export interface ServerConfig {
  language: string;
  extensions: string[];
  command: string;
  args: string[];
  installType?: "npm" | "pip" | "rustup";
  npmPackages?: string[];
  pipPackage?: string;
  rustupComponent?: string;
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
    installType: "rustup",
    rustupComponent: "rust-analyzer",
    installHint: "Install rust-analyzer: rustup component add rust-analyzer",
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
  try {
    const resolved = await which(cfg.command);
    return resolved;
  } catch {
    return null;
  }
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
    } else if (cfg.installType === "rustup") {
      try {
        await which("rustup");
      } catch {
        return { ok: false, error: cfg.installHint ?? "rustup not found — install Rust from https://rustup.rs first" };
      }
      await execAsync(`rustup component add ${cfg.rustupComponent}`, { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
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
      manualCmd = `rustup component add ${cfg.rustupComponent}`;
    }
    return { ok: false, error: `Failed to install ${cfg.command}: ${msg}\nTry manually: ${manualCmd}` };
  }
}
