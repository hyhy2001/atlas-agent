import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { MessageParam } from "./provider/types.js";
import { paths } from "./paths.js";
import { sequential } from "./utils/sequential.js";

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messageCount: number;
  messages: MessageParam[];
  title?: string;
}

export interface SessionMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messageCount: number;
  title?: string;
}

export function generateSessionTitle(messages: MessageParam[]): string {
  const firstUser = messages.find(m => m.role === "user");
  if (!firstUser) return "";
  const rawContent = firstUser.content as unknown;
  const content = typeof rawContent === "string"
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
      : "";
  return content.replace(/\n+/g, " ").trim().slice(0, 60);
}

function getSessionsDir(): string {
  return paths.sessions();
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

export const saveSession = sequential(async (session: Session): Promise<void> => {
  const dir = getSessionsDir();
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${session.id}.json`);
  await writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
});

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
        title: data.title,
      });
    } catch {
      // skip corrupt files
    }
  }

  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sessions;
}
