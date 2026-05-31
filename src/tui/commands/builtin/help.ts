import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";

export const helpCommand: LocalCommand = {
  kind: "local",
  name: "help",
  description: "Show available commands",
  source: "builtin",
  call(): LocalCommandResult {
    return {
      type: "text",
      value: [
        "Commands:",
        "  /save /sessions /load <id> /resume /clear /context",
        "  /plan /execute /compact /cost /stats [all|<id>] /init",
        "  /bg [list|<cmd>|kill <id>|log <id>] : background bash jobs",
        "  /diff [path] /undo /worktree [list|create|enter|exit|remove]",
        "  /agent <name> [prompt] /agents /model [tier] [name] /doctor /trust [dir]",
        "  /mcp : list connected MCP servers and their tools",
        "  /theme /output [default|compact|verbose] /version /config",
        "  /tasks /cron /team /skills",
        "",
        "Multi-line: type ``` to start/end a block, or end a line with \\ to continue",
        "@file.ts injects file content into your prompt",
      ].join("\n"),
    };
  },
};
