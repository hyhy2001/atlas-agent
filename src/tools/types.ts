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
}

export interface SessionPermissions {
  check(toolName: string): boolean;
  grant(toolName: string): void;
}
