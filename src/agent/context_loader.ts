import { promises as fs } from "node:fs";
import path from "node:path";

const CANDIDATES = [".atlas/ATLAS.md", "ATLAS.md", ".atlas/AGENT.md"];

export async function findProjectContextPath(cwd: string): Promise<string | null> {
  for (const candidate of CANDIDATES) {
    const p = path.join(cwd, candidate);
    try {
      const stat = await fs.stat(p);
      if (stat.isFile()) {
        // Return a path relative to cwd so logging is concise
        return path.relative(cwd, p) || candidate;
      }
    } catch (err) {
      // ignore
    }
  }
  return null;
}

export async function loadProjectContext(cwd: string): Promise<string | null> {
  const found = await findProjectContextPath(cwd);
  if (!found) return null;
  const full = path.join(cwd, found);
  try {
    const content = await fs.readFile(full, "utf-8");
    return content;
  } catch (err) {
    return null;
  }
}
