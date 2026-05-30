import type { ToolDef } from "../provider/types.js";

// Lock tool schema bytes at first render per session so the tool block stays
// byte-identical across turns — prevents prompt cache busts from minor
// schema fluctuations (e.g. MCP reconnect, flag changes).
// Cleared when the tool list structurally changes (different tool count).

let cachedTools: ToolDef[] | null = null;
let cachedCount = 0;

export function getCachedTools(tools: ToolDef[]): ToolDef[] {
  if (cachedTools && tools.length === cachedCount) {
    return cachedTools;
  }
  cachedTools = tools;
  cachedCount = tools.length;
  return tools;
}

export function clearToolSchemaCache(): void {
  cachedTools = null;
  cachedCount = 0;
}
