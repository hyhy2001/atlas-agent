import { promises as fs } from "node:fs";
import path from "node:path";
import { paths } from "../paths.js";

const OFFLOAD_THRESHOLD_BYTES = 20_000;  // ~5k tokens — offload anything bigger
const PREVIEW_BYTES = 2000;

// Middle-cut truncation: keep the head AND tail, drop the middle. Tool output's
// last lines often carry the result/error that matters most, so a tail-only cut
// loses signal. Prepends a line count so the model knows what was dropped.
// (codex output-truncation strategy.)
export function truncateMiddle(content: string, maxBytes: number): string {
  const size = Buffer.byteLength(content, "utf8");
  if (size <= maxBytes) return content;
  const lineCount = content.split("\n").length;
  const half = Math.floor(maxBytes / 2);
  const head = content.slice(0, half);
  const tail = content.slice(-half);
  return [
    `[Total output: ${lineCount} lines / ${size} bytes — middle truncated]`,
    head,
    `\n… [${size - maxBytes} bytes omitted] …\n`,
    tail,
  ].join("\n");
}

// When a tool result is large, write it to disk and replace its content with
// a short preview + a path. Saves token budget on long bash/grep output.
// Idempotent per toolUseId — if the file already exists, we don't overwrite.
export async function offloadIfLarge(toolUseId: string, content: string): Promise<string> {
  const size = Buffer.byteLength(content, "utf8");
  if (size <= OFFLOAD_THRESHOLD_BYTES) return content;

  const dir = path.join(paths.cache(), "tool-results");
  await fs.mkdir(dir, { recursive: true });
  const safeId = toolUseId.replace(/[^a-zA-Z0-9_-]/g, "_") || `tr-${Date.now()}`;
  const filePath = path.join(dir, `${safeId}.txt`);
  try {
    await fs.writeFile(filePath, content, { flag: "wx" });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "EEXIST") throw err;
    // already written — keep existing for replay byte-stability
  }

  // Keep head + tail (middle-cut) so the preview retains the final lines,
  // which usually hold the result or error.
  const lineCount = content.split("\n").length;
  const halfPreview = Math.floor(PREVIEW_BYTES / 2);
  const head = content.slice(0, halfPreview);
  const tail = content.slice(-halfPreview);
  return [
    head,
    `\n… [middle omitted] …\n`,
    tail,
    "",
    `[Output truncated: ${size} bytes / ${lineCount} lines]`,
    `[Full output saved to: ${filePath}]`,
    `[Read the file directly if you need the rest]`,
  ].join("\n");
}

const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 50_000;
const CLEARED_MARKER = "[Old tool result content cleared to save context — re-run the tool if needed]";

// Aggregate cap across multiple tool results in one assistant turn. When the
// combined size exceeds the cap, the OLDEST results are replaced with a cleared
// marker (newest kept intact), since recent results are most relevant.
// (cc-ref applyToolResultBudget strategy.)
export function applyToolResultBudget(results: string[]): string[] {
  const total = results.reduce((sum, r) => sum + r.length, 0);
  if (total <= MAX_TOOL_RESULTS_PER_MESSAGE_CHARS) return results;

  // Walk newest → oldest, keeping until the budget is spent.
  const out = [...results];
  let budget = MAX_TOOL_RESULTS_PER_MESSAGE_CHARS;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].length <= budget) {
      budget -= out[i].length;
    } else {
      out[i] = CLEARED_MARKER;
    }
  }
  return out;
}

// Delete tool-result files older than maxAgeDays. Best-effort: errors swallowed
// so housekeeping never breaks startup. Returns the number of files deleted.
export async function cleanupOldToolResults(maxAgeDays = 7): Promise<number> {
  const dir = path.join(paths.cache(), "tool-results");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  await Promise.all(entries.map(async (name) => {
    const filePath = path.join(dir, name);
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        await fs.unlink(filePath);
        deleted++;
      }
    } catch {
      // ignore individual file errors
    }
  }));
  return deleted;
}
