interface ReadEntry {
  path: string;
  content: string;
  readAt: number;
  bytes: number;
}

const MAX_ENTRIES = 20;
const entries: ReadEntry[] = [];

export function recordRead(path: string, content: string): void {
  const idx = entries.findIndex(e => e.path === path);
  if (idx >= 0) entries.splice(idx, 1);
  entries.unshift({ path, content, readAt: Date.now(), bytes: content.length });
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
}

export function getRecentReads(): ReadEntry[] {
  return [...entries];
}

export function clearReadState(): void {
  entries.length = 0;
}
