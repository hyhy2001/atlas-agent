import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JsonRpcConnection } from "./protocol.js";
import { ensureServerInstalled, findProjectRoot, serverForFile, type ServerConfig } from "./servers.js";
import type { Diagnostic, PublishDiagnosticsParams } from "./types.js";

interface ConnectionEntry {
  conn: JsonRpcConnection;
  cfg: ServerConfig;
  root: string;
  openDocs: Set<string>;
  diagnostics: Map<string, Diagnostic[]>;
}

export class LspManager {
  private connections = new Map<string, ConnectionEntry>();
  private installLog: string[] = [];

  drainInstallLog(): string[] {
    const log = [...this.installLog];
    this.installLog = [];
    return log;
  }

  async getConnection(filePath: string): Promise<{ entry: ConnectionEntry; cfg: ServerConfig }> {
    const cfg = serverForFile(filePath);
    if (!cfg) throw new Error(`No language server registered for ${path.extname(filePath)} files`);
    const root = findProjectRoot(filePath, cfg.rootMarkers);
    const key = `${cfg.language}:${root}`;
    const cached = this.connections.get(key);
    if (cached && !cached.conn.isClosed()) return { entry: cached, cfg };

    const install = await ensureServerInstalled(cfg);
    if (!install.ok || !install.command) throw new Error(install.error ?? "Install failed");
    if (install.installed) this.installLog.push(`Installed ${cfg.command} into .atlas/bin/lsp`);

    const proc = spawn(install.command, cfg.args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    const conn = new JsonRpcConnection(proc);

    const rootUri = pathToFileURL(root).toString();
    await conn.sendRequest("initialize", {
      processId: process.pid,
      rootUri,
      rootPath: root,
      workspaceFolders: [{ uri: rootUri, name: path.basename(root) }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: true },
          definition: { linkSupport: true },
          references: {},
          hover: { contentFormat: ["markdown", "plaintext"] },
          publishDiagnostics: {},
        },
      },
    }, 30_000);
    conn.sendNotification("initialized", {});

    const entry: ConnectionEntry = { conn, cfg, root, openDocs: new Set(), diagnostics: new Map() };

    conn.onNotification("textDocument/publishDiagnostics", (params) => {
      const p = params as PublishDiagnosticsParams;
      if (p?.uri) entry.diagnostics.set(p.uri, p.diagnostics ?? []);
    });

    this.connections.set(key, entry);
    return { entry, cfg };
  }

  async openDocument(entry: ConnectionEntry, filePath: string): Promise<string> {
    const abs = path.resolve(filePath);
    const uri = pathToFileURL(abs).toString();
    if (entry.openDocs.has(uri)) return uri;
    const text = await fs.readFile(abs, "utf8");
    const ext = path.extname(abs).toLowerCase();
    const languageIdMap: Record<string, string> = {
      ".ts": "typescript", ".tsx": "typescriptreact",
      ".mts": "typescript", ".cts": "typescript",
      ".js": "javascript", ".jsx": "javascriptreact",
      ".mjs": "javascript", ".cjs": "javascript",
      ".py": "python", ".pyi": "python",
      ".c": "c", ".h": "c",
      ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".hh": "cpp",
      ".v": "verilog", ".sv": "systemverilog", ".svh": "systemverilog",
    };
    const languageId = languageIdMap[ext] ?? entry.cfg.language;
    entry.conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
    entry.openDocs.add(uri);
    return uri;
  }

  async shutdown(): Promise<void> {
    for (const [, entry] of this.connections) {
      try { await entry.conn.sendRequest("shutdown", null, 2000); } catch {}
      try { entry.conn.sendNotification("exit"); } catch {}
      entry.conn.close();
    }
    this.connections.clear();
  }
}

let _instance: LspManager | null = null;
export function getLspManager(): LspManager {
  if (!_instance) _instance = new LspManager();
  return _instance;
}
