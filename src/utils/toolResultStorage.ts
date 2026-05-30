import { promises as fs } from "node:fs";
import path from "node:path";
import { paths } from "../paths.js";

const OFFLOAD_THRESHOLD_BYTES = 20_000;  // ~5k tokens — offload anything bigger
const PREVIEW_BYTES = 2000;

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

  const preview = content.slice(0, PREVIEW_BYTES);
  const truncatedNote = preview.length < content.length ? "…" : "";
  const lineCount = content.split("\n").length;
  return [
    preview + truncatedNote,
    "",
    `[Output truncated: ${size} bytes / ${lineCount} lines]`,
    `[Full output saved to: ${filePath}]`,
    `[Read the file directly if you need the rest]`,
  ].join("\n");
}
