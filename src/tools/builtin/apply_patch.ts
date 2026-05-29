import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";
import { pushUndo } from "../../undo.js";

interface PatchEdit {
  path: string;
  edits: Array<{ old: string; new: string }>;
}

function parseUnifiedPatch(patch: string): PatchEdit[] {
  const results: PatchEdit[] = [];
  const fileBlocks = patch.split(/^--- /m).slice(1);

  for (const block of fileBlocks) {
    const lines = block.split("\n");
    const pathLine = lines[0].trim();
    const filePath = pathLine.replace(/^a\//, "").replace(/^b\//, "");

    const edits: Array<{ old: string; new: string }> = [];
    let oldLines: string[] = [];
    let newLines: string[] = [];
    let inHunk = false;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("@@") || line.startsWith("+++ ")) {
        if (oldLines.length || newLines.length) {
          edits.push({ old: oldLines.join("\n"), new: newLines.join("\n") });
          oldLines = [];
          newLines = [];
        }
        inHunk = line.startsWith("@@");
        continue;
      }
      if (!inHunk) continue;
      if (line.startsWith("-")) {
        oldLines.push(line.slice(1));
      } else if (line.startsWith("+")) {
        newLines.push(line.slice(1));
      } else if (line.startsWith(" ")) {
        oldLines.push(line.slice(1));
        newLines.push(line.slice(1));
      }
    }
    if (oldLines.length || newLines.length) {
      edits.push({ old: oldLines.join("\n"), new: newLines.join("\n") });
    }

    if (edits.length > 0) {
      results.push({ path: filePath, edits });
    }
  }

  return results;
}

function parseSimplePatch(patch: string): PatchEdit[] {
  const results: PatchEdit[] = [];
  const fileBlocks = patch.split(/^--- /m).slice(1);

  for (const block of fileBlocks) {
    const lines = block.split("\n");
    const filePath = lines[0].trim();
    const content = lines.slice(1).join("\n");

    const edits: Array<{ old: string; new: string }> = [];
    const editRegex = /<<<\n([\s\S]*?)\n===\n([\s\S]*?)\n>>>/g;
    let match: RegExpExecArray | null;
    while ((match = editRegex.exec(content)) !== null) {
      edits.push({ old: match[1], new: match[2] });
    }

    if (edits.length > 0) {
      results.push({ path: filePath, edits });
    }
  }

  return results;
}

function parsePatch(patch: string): PatchEdit[] {
  if (patch.includes("<<<") && patch.includes(">>>")) {
    return parseSimplePatch(patch);
  }
  return parseUnifiedPatch(patch);
}

export const applyPatchTool: ToolDefinition = {
  name: "apply_patch",
  description:
    "Apply multiple edits to one or more files atomically using unified diff format. More efficient than multiple edit_file calls.",
  inputSchema: {
    properties: {
      patch: {
        type: "string",
        description:
          "Unified diff format patch. Use --- a/path and +++ b/path headers, @@ hunk markers, -/+ lines for changes.",
      },
    },
    required: ["patch"],
  },
  isDestructive: true,

  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { patch } = input as { patch: string };

    let fileEdits: PatchEdit[];
    try {
      fileEdits = parsePatch(patch);
    } catch (err) {
      return { toolUseId: "", content: `Error parsing patch: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }

    if (fileEdits.length === 0) {
      return { toolUseId: "", content: "Error: no edits found in patch", isError: true };
    }

    const fileContents = new Map<string, string>();
    for (const fe of fileEdits) {
      const fullPath = resolve(ctx.workingDir, fe.path);
      try {
        const content = await readFile(fullPath, "utf-8");
        fileContents.set(fullPath, content);
      } catch {
        return { toolUseId: "", content: `Error: cannot read file: ${fe.path}`, isError: true };
      }
    }

    const newContents = new Map<string, string>();
    for (const fe of fileEdits) {
      const fullPath = resolve(ctx.workingDir, fe.path);
      let content = fileContents.get(fullPath)!;

      for (const edit of fe.edits) {
        if (!content.includes(edit.old)) {
          return { toolUseId: "", content: `Error: old text not found in ${fe.path}:\n${edit.old.slice(0, 100)}`, isError: true };
        }
        content = content.replace(edit.old, edit.new);
      }

      newContents.set(fullPath, content);
    }

    const modified: string[] = [];
    for (const [fullPath, newContent] of newContents) {
      const original = fileContents.get(fullPath)!;
      pushUndo({ path: fullPath, previousContent: original, timestamp: Date.now() });
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, newContent, "utf-8");
      modified.push(fullPath.replace(ctx.workingDir + "/", ""));
    }

    const editCount = fileEdits.reduce((sum, fe) => sum + fe.edits.length, 0);
    return {
      toolUseId: "",
      content: `Applied ${editCount} edit(s) to ${modified.length} file(s):\n${modified.map((f) => `  ${f}`).join("\n")}`,
      isError: false,
    };
  },
};
