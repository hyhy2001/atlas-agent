import { mkdir, writeFile, readFile, readdir, appendFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { MessageParam } from "./provider/types.js";
import { paths } from "./paths.js";
import { sequential } from "./utils/sequential.js";

export type SessionEntry =
  | (MessageParam & { uuid: string; timestamp: string })
  | { type: "session_meta"; uuid: string; timestamp: string; sessionId: string; createdAt: string; model: string; title?: string }
  | { type: "compact_boundary"; uuid: string; timestamp: string; preCompactCount: number; preCompactTokens?: number; summary?: string };

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
  const rand = randomUUID().slice(0, 8);
  return `${date}-${time}-${rand}`;
}

export function generateMessageUuid(): string {
  return randomUUID();
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

function sessionPath(id: string): string {
  return join(getSessionsDir(), `${id}.jsonl`);
}

export const appendSessionEntry = sequential(async (sessionId: string, entry: SessionEntry): Promise<void> => {
  const dir = getSessionsDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }
  const filePath = sessionPath(sessionId);
  const line = JSON.stringify(entry) + "\n";
  if (!existsSync(filePath)) {
    await writeFile(filePath, line, { encoding: "utf-8", mode: 0o600 });
  } else {
    await appendFile(filePath, line, "utf-8");
  }
});

export async function initSession(sessionId: string, opts: { model: string; title?: string }): Promise<void> {
  const now = new Date().toISOString();
  await appendSessionEntry(sessionId, {
    type: "session_meta",
    uuid: randomUUID(),
    timestamp: now,
    sessionId,
    createdAt: now,
    model: opts.model,
    title: opts.title,
  });
}

export async function loadSession(id: string): Promise<Session | null> {
  const filePath = sessionPath(id);
  if (!existsSync(filePath)) {
    const oldPath = join(getSessionsDir(), `${id}.json`);
    if (existsSync(oldPath)) {
      try {
        const raw = await readFile(oldPath, "utf-8");
        return JSON.parse(raw) as Session;
      } catch {
        return null;
      }
    }
    return null;
  }

  try {
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.split("\n").filter(l => l.trim());
    const entries: SessionEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as SessionEntry);
      } catch {}
    }

    let startIdx = 0;
    let lastSummary: string | undefined;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i] as any;
      if (e?.type === "compact_boundary") {
        startIdx = i + 1;
        lastSummary = e.summary;
        break;
      }
    }

    let createdAt = new Date().toISOString();
    let model = "";
    let title: string | undefined;
    for (const e of entries) {
      if ((e as any).type === "session_meta") {
        const m = e as any;
        createdAt = m.createdAt;
        model = m.model;
        title = m.title;
      }
    }

    const messages: MessageParam[] = [];
    if (lastSummary) {
      messages.push({ role: "user", content: `[Compacted summary of previous turns]\n\n${lastSummary}` });
    }
    for (let i = startIdx; i < entries.length; i++) {
      const e = entries[i] as any;
      if (e.role === "user" || e.role === "assistant" || e.role === "system" || e.role === "tool") {
        const { uuid, timestamp, ...msg } = e;
        messages.push(msg as MessageParam);
      }
    }

    const updatedAt = entries.length > 0 ? (entries[entries.length - 1] as any).timestamp ?? createdAt : createdAt;
    return {
      id,
      createdAt,
      updatedAt,
      model,
      messageCount: messages.length,
      messages,
      title: title || generateSessionTitle(messages),
    };
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
    if (!file.endsWith(".jsonl") && !file.endsWith(".json")) continue;
    const id = file.replace(/\.(jsonl|json)$/, "");
    try {
      const filePath = join(dir, file);
      const stats = await stat(filePath);
      if (file.endsWith(".jsonl")) {
        const raw = await readFile(filePath, "utf-8");
        const lines = raw.split("\n").filter(l => l.trim());
        let createdAt = stats.birthtime?.toISOString() ?? stats.mtime.toISOString();
        let updatedAt = stats.mtime.toISOString();
        let model = "";
        let title: string | undefined;
        let messageCount = 0;
        let firstUserContent: string | undefined;
        for (const line of lines) {
          try {
            const e: any = JSON.parse(line);
            if (e.type === "session_meta") {
              createdAt = e.createdAt;
              model = e.model;
              if (e.title) title = e.title;
            } else if (e.role === "user" || e.role === "assistant") {
              messageCount++;
              if (e.role === "user" && !firstUserContent) {
                firstUserContent = typeof e.content === "string"
                  ? e.content
                  : Array.isArray(e.content)
                    ? e.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
                    : "";
              }
              if (e.timestamp) updatedAt = e.timestamp;
            }
          } catch {}
        }
        if (!title && firstUserContent) {
          title = firstUserContent.replace(/\n+/g, " ").trim().slice(0, 60);
        }
        sessions.push({ id, createdAt, updatedAt, model, messageCount, title });
      } else {
        const raw = await readFile(filePath, "utf-8");
        const data = JSON.parse(raw) as Session;
        sessions.push({
          id: data.id,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          model: data.model,
          messageCount: data.messageCount,
          title: data.title,
        });
      }
    } catch {}
  }

  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sessions;
}

export async function appendMessage(sessionId: string, message: MessageParam): Promise<string> {
  const uuid = generateMessageUuid();
  const timestamp = new Date().toISOString();
  await appendSessionEntry(sessionId, { ...message, uuid, timestamp });
  return uuid;
}

export async function appendCompactBoundary(sessionId: string, opts: { preCompactCount: number; preCompactTokens?: number; summary?: string }): Promise<void> {
  await appendSessionEntry(sessionId, {
    type: "compact_boundary",
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    ...opts,
  });
}

export const saveSession = sequential(async (session: Session): Promise<void> => {
  const dir = getSessionsDir();
  if (!existsSync(dir)) await mkdir(dir, { recursive: true, mode: 0o700 });
  const filePath = sessionPath(session.id);
  const lines: string[] = [];
  lines.push(JSON.stringify({
    type: "session_meta",
    uuid: randomUUID(),
    timestamp: session.createdAt,
    sessionId: session.id,
    createdAt: session.createdAt,
    model: session.model,
    title: session.title,
  }));
  for (const msg of session.messages) {
    lines.push(JSON.stringify({ ...msg, uuid: randomUUID(), timestamp: session.updatedAt }));
  }
  await writeFile(filePath, lines.join("\n") + "\n", { encoding: "utf-8", mode: 0o600 });
});
