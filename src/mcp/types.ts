export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  autoApprove: boolean;
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
