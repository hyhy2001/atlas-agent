import path from "node:path";
import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";

export const cronCommand: LocalCommand = {
  kind: "local",
  name: "cron",
  description: "List scheduled cron jobs",
  source: "builtin",
  async call(ctx: SlashCommandContext): Promise<LocalCommandResult> {
    const { getCronScheduler } = await import("../../../cron/scheduler.js");
    const scheduler = getCronScheduler(path.join(ctx.cwd, ".atlas", "cron.json"));
    const jobs = scheduler.list();

    if (jobs.length === 0) return { type: "text", value: "No scheduled jobs." };

    const lines = jobs.map(j => {
      const recurring = j.recurring ? " (recurring)" : "";
      const durable = j.durable ? " [durable]" : "";
      const promptShort = j.prompt.length > 50 ? j.prompt.slice(0, 50) + "…" : j.prompt;
      return `  #${j.id} ${j.cron} — next: ${j.nextFireAt}${recurring}${durable} — "${promptShort}"`;
    });

    return { type: "text", value: `Scheduled jobs (${jobs.length}):\n${lines.join("\n")}` };
  },
};
