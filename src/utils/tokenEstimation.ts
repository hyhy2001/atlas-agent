import path from "node:path";

// Most text averages ~4 bytes/token. JSON is denser in punctuation and short
// tokens, so it under-counts badly at 4 — use ~2 bytes/token for JSON-family
// files. Used to decide when a tool result is large enough to offload to disk
// and for rough budget tracking.
export function bytesPerTokenForFile(filePath?: string): number {
  if (!filePath) return 4;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json" || ext === ".jsonl" || ext === ".jsonc") return 2;
  return 4;
}

export function estimateTokens(text: string, filePath?: string): number {
  const ratio = bytesPerTokenForFile(filePath);
  return Math.ceil(Buffer.byteLength(text, "utf8") / ratio);
}
