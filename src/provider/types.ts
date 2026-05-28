export interface ProviderConfig {
  baseURL?: string;
  apiKey: string;
  model: string;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolResult {
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface StreamDelta {
  type: "text" | "tool_call_start" | "tool_call_delta" | "done" | "usage";
  text?: string;
  toolCallId?: string;
  toolCallName?: string;
  argumentsDelta?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
}

export type MessageParam = Message;
export type Tool = ToolDef;
export type ContentBlock = unknown;
export type ToolUseBlock = unknown;
export type ToolResultBlockParam = unknown;
