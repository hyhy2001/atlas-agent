import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import type { MessageParam } from "./provider/types.js";

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messageCount: number;
  messages: MessageParam[];
}

export interface SessionMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messageCount: number;
}

function getSessionsDir(): string {
  const portable = process.argv[1] ? join(dirname(resolve(process.argv[1])), "sessions") : null;
  if (portable && existsSync(portable)) return portable;
  return join(homedir(), ".config", "atlas-agent", "sessions");
}

export function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time =
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");
  const rand = Math.random().toString(16).slice(2, 6);
  return `${date}-${time}-${rand}`;
}

export async function saveSession(session: Session): Promise<void> {
  const dir = getSessionsDir();
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${session.id}.json`);
  await writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
}

export async function loadSession(id: string): Promise<Session | null> {
  const filePath = join(getSessionsDir(), `${id}.json`);
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<SessionMeta[]> {
  const dir = getSessionsDir();
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const sessions: SessionMeta[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, file), "utf-8");
      const data = JSON.parse(raw) as Session;
      sessions.push({
        id: data.id,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        model: data.model,
        messageCount: data.messageCount,
      });
    } catch {
      // skip corrupt files
    }
  }

  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sessions;
}
