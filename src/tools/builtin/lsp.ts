import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLspManager } from "../../lsp/manager.js";
import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";
import type { Location, LocationLink, Hover, Diagnostic } from "../../lsp/types.js";

const MAX_LSP_FILE_SIZE = 10_000_000;
const DIAG_WAIT_MS = 3000;

interface LspInput {
  operation: "goToDefinition" | "findReferences" | "hover" | "diagnostics";
  filePath: string;
  line?: number;
  character?: number;
}

function formatLocation(loc: Location | LocationLink): string {
  const uri = "uri" in loc ? loc.uri : loc.targetUri;
  const range = "range" in loc ? loc.range : loc.targetSelectionRange;
  const filePath = uri.startsWith("file://") ? fileURLToPath(uri) : uri;
  return `${filePath}:${range.start.line + 1}:${range.start.character + 1}`;
}

function formatHover(hover: Hover): string {
  const c = hover.contents;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map(item => typeof item === "string" ? item : item.value).join("\n\n");
  }
  return c.value;
}

function severityLabel(s?: number): string {
  return ["", "error", "warning", "info", "hint"][s ?? 0] ?? "info";
}

export const lspTool: ToolDefinition = {
  name: "lsp",
  description: `Query a language server for semantic code intelligence.
Operations:
  goToDefinition - find where a symbol is defined (requires line + character)
  findReferences - find all usages of a symbol (requires line + character)
  hover          - get type info and docs for a symbol (requires line + character)
  diagnostics    - get type errors and warnings for a file (no line/character needed)
Supports: TypeScript, JavaScript, Python, C, C++, Verilog/SystemVerilog.
Language servers are auto-installed on first use if not present.`,
  inputSchema: {
    properties: {
      operation: {
        type: "string",
        enum: ["goToDefinition", "findReferences", "hover", "diagnostics"],
        description: "The LSP operation to perform",
      },
      filePath: {
        type: "string",
        description: "Path to the source file (absolute or relative to cwd)",
      },
      line: {
        type: "number",
        description: "1-based line number (required for goToDefinition, findReferences, hover)",
      },
      character: {
        type: "number",
        description: "1-based column number (required for goToDefinition, findReferences, hover)",
      },
    },
    required: ["operation", "filePath"],
  },
  isDestructive: false,

  async execute(rawInput: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const toolUseId = "";
    const input = rawInput as LspInput;
    const { operation, filePath } = input;

    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(ctx.workingDir, filePath);

    try {
      const { stat } = await import("node:fs/promises");
      const s = await stat(absPath);
      if (s.size > MAX_LSP_FILE_SIZE) {
        return { toolUseId, content: `File too large for LSP (${s.size} bytes, max ${MAX_LSP_FILE_SIZE})`, isError: true };
      }
    } catch {
      return { toolUseId, content: `File not found: ${absPath}`, isError: true };
    }

    if (operation !== "diagnostics") {
      if (!input.line || !input.character) {
        return { toolUseId, content: `operation '${operation}' requires line and character`, isError: true };
      }
    }

    const manager = getLspManager();
    let entry: Awaited<ReturnType<typeof manager.getConnection>>["entry"];
    try {
      const result = await manager.getConnection(absPath);
      entry = result.entry;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { toolUseId, content: `LSP error: ${msg}`, isError: true };
    }

    const installLog = manager.drainInstallLog();
    const prefix = installLog.length > 0 ? installLog.join("\n") + "\n\n" : "";

    let uri: string;
    try {
      uri = await manager.openDocument(entry, absPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { toolUseId, content: `${prefix}Failed to open document: ${msg}`, isError: true };
    }

    const position = operation !== "diagnostics"
      ? { line: (input.line! - 1), character: (input.character! - 1) }
      : null;

    try {
      if (operation === "goToDefinition") {
        const result = await entry.conn.sendRequest<Location | Location[] | LocationLink[] | null>(
          "textDocument/definition",
          { textDocument: { uri }, position }
        );
        if (!result || (Array.isArray(result) && result.length === 0)) {
          return { toolUseId, content: `${prefix}No definition found`, isError: false };
        }
        const locs = Array.isArray(result) ? result : [result];
        const lines = locs.map(l => formatLocation(l as Location | LocationLink));
        return { toolUseId, content: `${prefix}Definition:\n${lines.join("\n")}`, isError: false };
      }

      if (operation === "findReferences") {
        const result = await entry.conn.sendRequest<Location[] | null>(
          "textDocument/references",
          { textDocument: { uri }, position, context: { includeDeclaration: true } }
        );
        if (!result || result.length === 0) {
          return { toolUseId, content: `${prefix}No references found`, isError: false };
        }
        const lines = result.map(l => formatLocation(l));
        return { toolUseId, content: `${prefix}References (${result.length}):\n${lines.join("\n")}`, isError: false };
      }

      if (operation === "hover") {
        const result = await entry.conn.sendRequest<Hover | null>(
          "textDocument/hover",
          { textDocument: { uri }, position }
        );
        if (!result) {
          return { toolUseId, content: `${prefix}No hover info available`, isError: false };
        }
        return { toolUseId, content: `${prefix}${formatHover(result)}`, isError: false };
      }

      if (operation === "diagnostics") {
        const existing = entry.diagnostics.get(uri);
        if (!existing) {
          await new Promise<void>(resolve => {
            const timer = setTimeout(resolve, DIAG_WAIT_MS);
            const poll = setInterval(() => {
              if (entry.diagnostics.has(uri)) { clearInterval(poll); clearTimeout(timer); resolve(); }
            }, 100);
          });
        }
        const diags: Diagnostic[] = entry.diagnostics.get(uri) ?? [];
        if (diags.length === 0) {
          return { toolUseId, content: `${prefix}No diagnostics (file may still be analyzing)`, isError: false };
        }
        const lines = diags.map(d =>
          `${absPath}:${d.range.start.line + 1}:${d.range.start.character + 1}: ${severityLabel(d.severity)}: ${d.message}${d.source ? ` [${d.source}]` : ""}`
        );
        return { toolUseId, content: `${prefix}Diagnostics (${diags.length}):\n${lines.join("\n")}`, isError: false };
      }

      return { toolUseId, content: `Unknown operation: ${operation}`, isError: true };
    } catch (err) {
      if (ctx.abortSignal.aborted) {
        return { toolUseId, content: "LSP request aborted", isError: false };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { toolUseId, content: `${prefix}LSP error: ${msg}`, isError: true };
    }
  },
};
