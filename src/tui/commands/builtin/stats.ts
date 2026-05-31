import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";

export const statsCommand: LocalCommand = {
  kind: "local",
  name: "stats",
  description: "Show telemetry stats for current or a specific session",
  argumentHint: "[all|<session-id>]",
  source: "builtin",
  async call(ctx: SlashCommandContext): Promise<LocalCommandResult> {
    const app = ctx.app ?? {};
    const sessionId = (app["sessionId"] as string) ?? "";
    const arg = ctx.args.trim();
    const { getSessionStats, listAllSessionStats, formatStats } = await import("../../../telemetry.js");
    if (arg === "all") {
      const all = await listAllSessionStats();
      return {
        type: "text",
        value: all.length ? all.slice(0, 10).map(formatStats).join("\n\n") : "No telemetry data.",
      };
    }
    const stats = await getSessionStats(arg || sessionId);
    return {
      type: "text",
      value: stats ? formatStats(stats) : `No stats for session ${arg || "current"}.`,
    };
  },
};
