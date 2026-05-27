import Anthropic from "@anthropic-ai/sdk";

export interface ProviderConfig {
  baseURL?: string;
  apiKey: string;
  model: string;
}

export type MessageParam = Anthropic.MessageParam;
export type Tool = Anthropic.Tool;
export type ContentBlock = Anthropic.ContentBlock;
export type ToolUseBlock = Anthropic.ToolUseBlock;
export type ToolResultBlockParam = Anthropic.ToolResultBlockParam;
