export const DIFF_MARKER = "__ATLAS_DIFF__";

export interface DiffLine {
  type: "header" | "hunk" | "add" | "remove" | "context" | "ellipsis";
  lineNum?: number;
  text: string;
}

export function formatTokenCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

export function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const secs = Math.floor((now - then) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function formatToolName(name: string): string {
  const map: Record<string, string> = {
    bash: "Bash",
    read_file: "Read",
    write_file: "Write",
    edit_file: "Edit",
    grep: "Search",
    glob: "Find",
    list_directory: "List",
    web_fetch: "Fetch",
    git_status: "Git",
    git_diff: "Git",
    git_log: "Git",
    git_commit: "Commit",
    delegate: "Delegate",
    delegate_parallel: "Delegate",
    apply_patch: "Patch",
    read_many_files: "Read",
    todo_write: "Todo",
    todo_read: "Todo",
    memory_save: "Memory",
    memory_read: "Memory",
    memory_append: "Memory",
    analyze_log: "Analyze",
  };
  return map[name] ?? name.split("_").map(w => w[0].toUpperCase() + w.slice(1)).join("");
}

export function formatToolResult(text: string, maxLines = 5): { preview: string; hidden: number } {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return { preview: text, hidden: 0 };
  return {
    preview: lines.slice(0, maxLines).join("\n"),
    hidden: lines.length - maxLines,
  };
}

export function isDiffOutput(text: string): boolean {
  return text.startsWith(DIFF_MARKER);
}

export function parseDiffOutput(text: string): { header: string; lines: DiffLine[] } {
  const body = text.slice(DIFF_MARKER.length);
  const [header, ...rest] = body.split("\n");
  const lines: DiffLine[] = [];
  for (const raw of rest) {
    if (raw.startsWith("@@HUNK@@")) {
      lines.push({ type: "hunk", text: raw.slice("@@HUNK@@".length) });
    } else if (raw.startsWith("…@@")) {
      lines.push({ type: "ellipsis", text: raw.slice(3) });
    } else {
      const sep = raw.indexOf("@@");
      if (sep === -1) continue;
      const marker = raw[0];
      const lineNum = parseInt(raw.slice(1, sep)) || 0;
      const content = raw.slice(sep + 2);
      const type = marker === "+" ? "add" : marker === "-" ? "remove" : "context";
      lines.push({ type, lineNum, text: content });
    }
  }
  return { header, lines };
}
