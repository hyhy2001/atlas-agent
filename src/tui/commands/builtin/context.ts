import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";

export const contextCommand: LocalCommand = {
  kind: "local",
  name: "context",
  description: "Show approximate context window usage",
  source: "builtin",
  call(ctx: SlashCommandContext): LocalCommandResult {
    const app = ctx.app ?? {};
    const CONTEXT_LIMIT = 200_000;
    const sysTokens = Math.ceil(((app["systemPromptLength"] as number | undefined) ?? 0) / 4);
    const msgTokens = Math.ceil(((app["messagesJson"] as string | undefined) ?? "[]").length / 4);
    const toolTokens = Math.ceil(((app["toolsJson"] as string | undefined) ?? "[]").length / 4);
    const messageCount = (app["messageCount"] as number | undefined) ?? 0;
    const toolCount = (app["toolCount"] as number | undefined) ?? 0;
    const projectContextPath = app["projectContextPath"] as string | undefined;

    const used = sysTokens + msgTokens + toolTokens;
    const pct = Math.min(100, Math.round((used / CONTEXT_LIMIT) * 100));
    const barWidth = 30;
    const filled = Math.round((pct / 100) * barWidth);
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
    const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    const lines = [
      `Context usage: ${bar} ${pct}%  (${fmt(used)} / ${fmt(CONTEXT_LIMIT)})`,
      ``,
      `  System prompt: ${fmt(sysTokens)} tokens`,
      `  Messages (${messageCount}): ${fmt(msgTokens)} tokens`,
      `  Tool schemas (${toolCount}): ${fmt(toolTokens)} tokens`,
      ``,
      projectContextPath ? `Project context: ${projectContextPath}` : `No project context (run /init)`,
      pct > 70 ? `\n⚠ Context >70% — consider /compact to free space.` : ``,
    ].filter(Boolean);

    return { type: "text", value: lines.join("\n") };
  },
};
