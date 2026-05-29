import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";
import { pushUndo } from "../../undo.js";

interface FileOp {
  type: "update" | "add" | "delete";
  path: string;
  contexts?: string[];
  oldLines?: string[];
  newLines?: string[];
  addContent?: string;
  hunks?: Hunk[];
}

interface Hunk {
  contexts: string[];
  oldLines: string[];
  newLines: string[];
}

function parseCodexPatch(patch: string): FileOp[] {
  const lines = patch.split("\n");
  const ops: FileOp[] = [];
  let current: FileOp | null = null;
  let currentHunk: Hunk | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("*** Begin Patch") || line.startsWith("*** End Patch") || line === "") {
      if (line.startsWith("*** End Patch")) {
        if (currentHunk && current?.hunks) current.hunks.push(currentHunk);
        if (current) ops.push(current);
      }
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      if (currentHunk && current?.hunks) current.hunks.push(currentHunk);
      if (current) ops.push(current);
      current = { type: "update", path: line.slice(17).trim(), hunks: [] };
      currentHunk = null;
      continue;
    }

    if (line.startsWith("*** Add File: ")) {
      if (currentHunk && current?.hunks) current.hunks.push(currentHunk);
      if (current) ops.push(current);
      current = { type: "add", path: line.slice(14).trim(), addContent: "" };
      currentHunk = null;
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      if (currentHunk && current?.hunks) current.hunks.push(currentHunk);
      if (current) ops.push(current);
      current = { type: "delete", path: line.slice(17).trim() };
      currentHunk = null;
      continue;
    }

    if (!current) continue;

    if (current.type === "add") {
      if (line.startsWith("+")) {
        current.addContent = (current.addContent ?? "") + line.slice(1) + "\n";
      }
      continue;
    }

    if (current.type === "update") {
      if (line.startsWith("@@")) {
        if (currentHunk && (currentHunk.oldLines.length || currentHunk.newLines.length)) {
          current.hunks!.push(currentHunk);
          currentHunk = { contexts: [line.slice(2).trim()], oldLines: [], newLines: [] };
        } else if (currentHunk) {
          currentHunk.contexts.push(line.slice(2).trim());
        } else {
          currentHunk = { contexts: [line.slice(2).trim()], oldLines: [], newLines: [] };
        }
        continue;
      }

      if (!currentHunk) currentHunk = { contexts: [], oldLines: [], newLines: [] };

      if (line.startsWith("-")) {
        currentHunk.oldLines.push(line.slice(1));
      } else if (line.startsWith("+")) {
        currentHunk.newLines.push(line.slice(1));
      } else if (line.startsWith(" ")) {
        currentHunk.oldLines.push(line.slice(1));
        currentHunk.newLines.push(line.slice(1));
      }
    }
  }

  if (currentHunk && current?.hunks) current.hunks.push(currentHunk);
  if (current && !ops.includes(current)) ops.push(current);

  return ops;
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function findContextLine(content: string, contextHint: string): number {
  if (!contextHint.trim()) return -1;
  const lines = content.split("\n");
  const target = normalizeWhitespace(contextHint);

  for (let i = 0; i < lines.length; i++) {
    if (normalizeWhitespace(lines[i]).includes(target)) return i;
  }
  return -1;
}

function applyHunk(content: string, hunk: Hunk): { content: string; ok: boolean; error?: string } {
  if (hunk.oldLines.length === 0 && hunk.newLines.length === 0) {
    return { content, ok: true };
  }

  const lines = content.split("\n");
  let searchStart = 0;

  for (const ctx of hunk.contexts) {
    if (!ctx.trim()) continue;
    const idx = findContextLine(lines.slice(searchStart).join("\n"), ctx);
    if (idx === -1) {
      return { content, ok: false, error: `context not found: "${ctx}"` };
    }
    searchStart += idx;
  }

  const oldStr = hunk.oldLines.join("\n");
  const newStr = hunk.newLines.join("\n");

  if (oldStr === "") {
    const insertAt = searchStart + 1;
    const out = [...lines.slice(0, insertAt), ...newStr.split("\n"), ...lines.slice(insertAt)].join("\n");
    return { content: out, ok: true };
  }

  const remainingContent = lines.slice(searchStart).join("\n");
  if (remainingContent.includes(oldStr)) {
    const before = lines.slice(0, searchStart).join("\n");
    const replaced = remainingContent.replace(oldStr, newStr);
    return { content: before + (before ? "\n" : "") + replaced, ok: true };
  }

  const normalizedOld = normalizeWhitespace(oldStr);
  const normalizedRemaining = normalizeWhitespace(remainingContent);
  if (normalizedRemaining.includes(normalizedOld)) {
    const oldLineCount = hunk.oldLines.length;
    for (let i = searchStart; i <= lines.length - oldLineCount; i++) {
      const candidate = lines.slice(i, i + oldLineCount).join("\n");
      if (normalizeWhitespace(candidate) === normalizedOld) {
        const result = [...lines.slice(0, i), ...newStr.split("\n"), ...lines.slice(i + oldLineCount)].join("\n");
        return { content: result, ok: true };
      }
    }
  }

  return { content, ok: false, error: `old text not found:\n${oldStr.slice(0, 200)}` };
}

export const applyPatchTool: ToolDefinition = {
  name: "apply_patch",
  description: `Apply a Codex-style patch to add/update/delete files. Format:

*** Begin Patch
*** Update File: path/to/file.ts
@@ class Name
@@   methodName
-old line
+new line
*** Add File: path/to/new.ts
+new file content
*** Delete File: path/to/old.ts
*** End Patch

@@ lines provide context for locating the change (no exact prefix match needed). Whitespace-tolerant.`,
  inputSchema: {
    properties: {
      patch: {
        type: "string",
        description: "Codex-style patch text starting with *** Begin Patch and ending with *** End Patch",
      },
    },
    required: ["patch"],
  },
  isDestructive: true,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { patch } = input as { patch: string };

    let ops: FileOp[];
    try {
      ops = parseCodexPatch(patch);
    } catch (err) {
      return { toolUseId: "", content: `Parse error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }

    if (ops.length === 0) {
      return { toolUseId: "", content: "Error: no operations found in patch", isError: true };
    }

    const plannedWrites = new Map<string, string | null>();
    const fileSnapshots = new Map<string, string | null>();

    for (const op of ops) {
      const fullPath = resolve(ctx.workingDir, op.path);

      if (op.type === "delete") {
        if (!existsSync(fullPath)) {
          return { toolUseId: "", content: `Error: cannot delete non-existent file: ${op.path}`, isError: true };
        }
        try {
          fileSnapshots.set(fullPath, await readFile(fullPath, "utf-8"));
        } catch {}
        plannedWrites.set(fullPath, null);
        continue;
      }

      if (op.type === "add") {
        if (existsSync(fullPath)) {
          return { toolUseId: "", content: `Error: file already exists: ${op.path}`, isError: true };
        }
        fileSnapshots.set(fullPath, null);
        plannedWrites.set(fullPath, op.addContent ?? "");
        continue;
      }

      let content: string;
      try {
        content = await readFile(fullPath, "utf-8");
      } catch {
        return { toolUseId: "", content: `Error: cannot read ${op.path}`, isError: true };
      }
      fileSnapshots.set(fullPath, content);

      let modified = content;
      for (const hunk of op.hunks ?? []) {
        const result = applyHunk(modified, hunk);
        if (!result.ok) {
          return { toolUseId: "", content: `Error in ${op.path}: ${result.error}`, isError: true };
        }
        modified = result.content;
      }
      plannedWrites.set(fullPath, modified);
    }

    const summary: string[] = [];
    for (const [fullPath, newContent] of plannedWrites) {
      const original = fileSnapshots.get(fullPath) ?? null;
      pushUndo({ path: fullPath, previousContent: original, timestamp: Date.now() });

      const relPath = fullPath.replace(ctx.workingDir + "/", "");
      if (newContent === null) {
        await unlink(fullPath);
        summary.push(`  delete: ${relPath}`);
      } else {
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, newContent, "utf-8");
        if (original === null) {
          summary.push(`  add:    ${relPath}`);
        } else {
          summary.push(`  update: ${relPath}`);
        }
      }
    }

    return {
      toolUseId: "",
      content: `Applied ${ops.length} operation(s):\n${summary.join("\n")}`,
      isError: false,
    };
  },
};
