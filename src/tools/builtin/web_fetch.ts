import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const webFetchTool: ToolDefinition = {
  name: "web_fetch",
  description: "Fetch content from a URL. Use for reading documentation, datasheets, or web resources.",
  inputSchema: {
    properties: {
      url: { type: "string", description: "URL to fetch" },
      max_length: { type: "number", description: "Max characters to return (default 50000)" },
    },
    required: ["url"],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { url, max_length = 50000 } = input as { url: string; max_length?: number };
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "atlas-agent/0.1.0" },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        return { toolUseId: "", content: `HTTP ${response.status}: ${response.statusText}`, isError: true };
      }
      const contentType = response.headers.get("content-type") ?? "";
      let text = await response.text();
      if (contentType.includes("text/html")) {
        text = stripHtml(text);
      } else if (contentType.includes("application/json")) {
        try { text = JSON.stringify(JSON.parse(text), null, 2); } catch {}
      }
      const truncated = text.length > max_length;
      const content = truncated ? text.slice(0, max_length) + "\n\n(truncated)" : text;
      return { toolUseId: "", content, isError: false };
    } catch (err) {
      return { toolUseId: "", content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
