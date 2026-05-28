import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

export interface MemoryEntry {
  type: "user" | "project" | "feedback" | "reference";
  content: string;
  path: string;
}

function getMemoryDir(cwd: string): string {
  const local = resolve(cwd, ".atlas", "memory");
  if (existsSync(local)) return local;
  return join(homedir(), ".atlas", "memory");
}

export async function loadAllMemory(cwd: string): Promise<MemoryEntry[]> {
  const dir = getMemoryDir(cwd);
  if (!existsSync(dir)) return [];

  const entries: MemoryEntry[] = [];
  try {
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const content = await readFile(join(dir, file), "utf-8");
      const type = file.replace(".md", "") as MemoryEntry["type"];
      if (["user", "project", "feedback", "reference"].includes(type)) {
        entries.push({ type, content: content.trim(), path: join(dir, file) });
      }
    }
  } catch {}
  return entries;
}

export async function saveMemory(cwd: string, type: MemoryEntry["type"], content: string): Promise<string> {
  const dir = getMemoryDir(cwd);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${type}.md`);
  await writeFile(filePath, content.trim() + "\n", "utf-8");
  return filePath;
}

export async function appendMemory(cwd: string, type: MemoryEntry["type"], entry: string): Promise<string> {
  const dir = getMemoryDir(cwd);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${type}.md`);
  const existing = existsSync(filePath) ? await readFile(filePath, "utf-8") : "";
  const newContent = existing.trim() + (existing.trim() ? "\n\n" : "") + entry.trim() + "\n";
  await writeFile(filePath, newContent, "utf-8");
  return filePath;
}

export async function deleteMemory(cwd: string, type: MemoryEntry["type"]): Promise<boolean> {
  const dir = getMemoryDir(cwd);
  const filePath = join(dir, `${type}.md`);
  if (!existsSync(filePath)) return false;
  await unlink(filePath);
  return true;
}

export function formatMemoryForPrompt(entries: MemoryEntry[]): string {
  if (entries.length === 0) return "";
  let result = "\n\n# Memory (from past sessions)\n";
  for (const entry of entries) {
    const typeLabel = {
      user: "User Profile",
      project: "Project Context",
      feedback: "Feedback & Conventions",
      reference: "External References",
    }[entry.type];
    result += `\n## ${typeLabel}\n${entry.content}\n`;
  }
  return result;
}
