import { createPatch } from "diff";

const DIFF_MARKER = "__ATLAS_DIFF__";

export function formatToolDiff(filePath: string, oldContent: string, newContent: string): string {
  if (oldContent === newContent) return `${DIFF_MARKER}${filePath} (no changes)`;

  const patch = createPatch(filePath, oldContent, newContent, "", "", { context: 2 });
  const lines = patch.split("\n");
  let added = 0;
  let removed = 0;
  const diffLines: string[] = [];
  let currentLine = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@\s*-\d+(?:,\d+)?\s*\+(\d+)/);
      if (match) currentLine = parseInt(match[1]);
      diffLines.push(`@@HUNK@@${line}`);
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("Index:") || line.startsWith("===")) {
      continue;
    }
    if (line.startsWith("+")) {
      added++;
      diffLines.push(`+${currentLine}@@${line.slice(1)}`);
      currentLine++;
    } else if (line.startsWith("-")) {
      removed++;
      diffLines.push(`-${currentLine}@@${line.slice(1)}`);
    } else if (line.startsWith(" ") || line === "") {
      diffLines.push(` ${currentLine}@@${line.slice(1)}`);
      currentLine++;
    }
  }

  return `${DIFF_MARKER}${filePath} (+${added} -${removed})\n${diffLines.join("\n")}`;
}

export function formatNewFile(filePath: string, content: string): string {
  const lines = content.split("\n");
  const added = lines.length;
  const preview = lines.slice(0, 30).map((l, i) => `+${i + 1}@@${l}`).join("\n");
  const ellipsis = lines.length > 30 ? `\n…@@(+${lines.length - 30} more lines)` : "";
  return `${DIFF_MARKER}${filePath} (new file, +${added} -0)\n${preview}${ellipsis}`;
}

export const DIFF_PREFIX = DIFF_MARKER;
