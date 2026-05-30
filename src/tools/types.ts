import type { HooksConfig } from "../hooks.js";
import type { OpenAIProvider } from "../provider/openai.js";
import type { ToolExecutor } from "./executor.js";
import type { ToolRegistry } from "./registry.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  isDestructive: boolean;
  execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult>;
}

export interface ToolResult {
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface ExecutionContext {
  workingDir: string;
  abortSignal: AbortSignal;
  permissions: SessionPermissions;
  provider?: OpenAIProvider;
  registry?: ToolRegistry;
  executor?: ToolExecutor;
  hooks?: HooksConfig;
  fastModel?: string;
  reasoningModel?: string;
  // Round-robin pickers — when set, take precedence over the single-string
  // fastModel/reasoningModel above. Each call returns the next model in the pool.
  pickFastModel?: () => string;
  pickReasoningModel?: () => string;
  trustedDirs?: string[];
  askUser?: (question: string, options: string[]) => Promise<string>;
}

export interface SessionPermissions {
  check(toolName: string): boolean;
  grant(toolName: string): void;
}
