import { promisify } from "node:util";
import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import which from "which";

const execAsync = promisify(exec);

export interface ServerConfig {
  language: string;
  extensions: string[];
  command: string;
  args: string[];
  installCmd?: string;
  installHint?: string;
  rootMarkers: string[];
}

export const SERVERS: ServerConfig[] = [
  {
    language: "typescript",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    command: "typescript-language-server",
    args: ["--stdio"],
    installCmd: "npm install -g typescript-language-server typescript",
    rootMarkers: ["tsconfig.json", "package.json", ".git"],
  },
  {
    language: "javascript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    command: "typescript-language-server",
    args: ["--stdio"],
    installCmd: "npm install -g typescript-language-server typescript",
    rootMarkers: ["package.json", ".git"],
  },
  {
    language: "python",
    extensions: [".py", ".pyi"],
    command: "pylsp",
    args: [],
    installCmd: "pip install python-lsp-server",
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

export interface InstallResult { ok: boolean; installed?: boolean; error?: string }

export async function ensureServerInstalled(cfg: ServerConfig): Promise<InstallResult> {
  try {
    await which(cfg.command);
    return { ok: true, installed: false };
  } catch {
    // not found
  }
  if (!cfg.installCmd) {
    return { ok: false, error: cfg.installHint ?? `${cfg.command} not found and no auto-install available` };
  }
  try {
    await execAsync(cfg.installCmd, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    await which(cfg.command);
    return { ok: true, installed: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to install ${cfg.command}: ${msg}\nTry manually: ${cfg.installCmd}` };
  }
}
