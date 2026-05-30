export interface HistoryEntry {
  type: "banner" | "user" | "assistant" | "system" | "tool_call" | "tool_result" | "tool_result_full" | "subagent_done" | "compact_boundary";
  text: string;
  fullText?: string;
  toolName?: string;
  isError?: boolean;
  nested?: boolean;
}

export interface OverlayItem {
  label: string;
  sublabel?: string;
  value: string;
}

export interface AgentTask {
  id: string;
  agent: string;
  status: "running" | "done" | "error";
  startedAt: number;
  durationMs?: number;
  toolUses?: number;
  tokens?: number;
  lastToolInfo?: string;
}
