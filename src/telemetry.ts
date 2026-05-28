import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./paths.js";

export interface TelemetryEvent {
  sessionId: string;
  timestamp: string;
  type: "session_start" | "turn_complete" | "tool_call" | "session_end";
  data: Record<string, unknown>;
}

export interface SessionStats {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCost: number;
  turns: number;
  toolCalls: Record<string, number>;
}

function getTelemetryDir(): string {
  return paths.telemetry();
}

export async function recordEvent(event: TelemetryEvent): Promise<void> {
  const dir = getTelemetryDir();
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${event.sessionId}.jsonl`);
  await writeFile(file, JSON.stringify(event) + "\n", { flag: "a", encoding: "utf-8" });
}

export async function getSessionStats(sessionId: string): Promise<SessionStats | null> {
  const dir = getTelemetryDir();
  const file = join(dir, `${sessionId}.jsonl`);
  if (!existsSync(file)) return null;

  const content = await readFile(file, "utf-8");
  const events: TelemetryEvent[] = content.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));

  if (events.length === 0) return null;

  const startEvent = events.find(e => e.type === "session_start");
  const endEvent = events.find(e => e.type === "session_end");
  const turnEvents = events.filter(e => e.type === "turn_complete");
  const toolEvents = events.filter(e => e.type === "tool_call");

  const inputTokens = turnEvents.reduce((sum, e) => sum + ((e.data.inputTokens as number) ?? 0), 0);
  const outputTokens = turnEvents.reduce((sum, e) => sum + ((e.data.outputTokens as number) ?? 0), 0);
  const cachedTokens = turnEvents.reduce((sum, e) => sum + ((e.data.cachedTokens as number) ?? 0), 0);

  const toolCalls: Record<string, number> = {};
  for (const e of toolEvents) {
    const name = e.data.toolName as string;
    toolCalls[name] = (toolCalls[name] ?? 0) + 1;
  }

  return {
    sessionId,
    startedAt: startEvent?.timestamp ?? events[0].timestamp,
    endedAt: endEvent?.timestamp,
    durationMs: endEvent ? new Date(endEvent.timestamp).getTime() - new Date(startEvent?.timestamp ?? events[0].timestamp).getTime() : undefined,
    model: (startEvent?.data.model as string) ?? "unknown",
    inputTokens,
    outputTokens,
    cachedTokens,
    estimatedCost: (inputTokens / 1_000_000) * 1.5 + (outputTokens / 1_000_000) * 15.0,
    turns: turnEvents.length,
    toolCalls,
  };
}

export async function listAllSessionStats(): Promise<SessionStats[]> {
  const dir = getTelemetryDir();
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const stats: SessionStats[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const sessionId = file.replace(".jsonl", "");
    const s = await getSessionStats(sessionId);
    if (s) stats.push(s);
  }
  return stats.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function formatStats(stats: SessionStats): string {
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const duration = stats.durationMs ? `${Math.round(stats.durationMs / 1000)}s` : "ongoing";
  const toolStr = Object.entries(stats.toolCalls)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}: ${count}`)
    .join(", ") || "(none)";

  return [
    `Session: ${stats.sessionId}`,
    `  Model:    ${stats.model}`,
    `  Started:  ${stats.startedAt}`,
    `  Duration: ${duration}`,
    `  Tokens:   ${fmt(stats.inputTokens)} in / ${fmt(stats.outputTokens)} out${stats.cachedTokens > 0 ? ` (${fmt(stats.cachedTokens)} cached)` : ""}`,
    `  Cost:     ~$${stats.estimatedCost.toFixed(3)}`,
    `  Turns:    ${stats.turns}`,
    `  Tools:    ${toolStr}`,
  ].join("\n");
}
