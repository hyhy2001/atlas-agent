import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { paths } from "./paths.js";
import { sequential } from "./utils/sequential.js";

export interface PromptHistoryEntry {
  display: string;
  timestamp: string;
  project: string;
  sessionId?: string;
}

const MAX_HISTORY = 200;

function historyPath(): string {
  return join(paths.atlas(), "history.jsonl");
}

export const appendHistory = sequential(async (entry: PromptHistoryEntry): Promise<void> => {
  const filePath = historyPath();
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  }
  const line = JSON.stringify(entry) + "\n";
  if (!existsSync(filePath)) {
    await fs.writeFile(filePath, line, { encoding: "utf-8", mode: 0o600 });
  } else {
    await fs.appendFile(filePath, line, "utf-8");
  }
});

export async function loadHistory(opts?: { project?: string; limit?: number }): Promise<PromptHistoryEntry[]> {
  const filePath = historyPath();
  if (!existsSync(filePath)) return [];
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw.split("\n").filter(l => l.trim());
    const entries: PromptHistoryEntry[] = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry: PromptHistoryEntry = JSON.parse(lines[i]!);
        if (opts?.project && entry.project !== opts.project) continue;
        entries.push(entry);
        if (opts?.limit && entries.length >= opts.limit) break;
      } catch { /* skip corrupt */ }
    }
    return entries;
  } catch { return []; }
}

export async function compactHistory(): Promise<void> {
  const filePath = historyPath();
  if (!existsSync(filePath)) return;
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw.split("\n").filter(l => l.trim());
    if (lines.length <= MAX_HISTORY) return;
    const kept = lines.slice(-MAX_HISTORY).join("\n") + "\n";
    await fs.writeFile(filePath, kept, { encoding: "utf-8", mode: 0o600 });
  } catch { /* ignore */ }
}
