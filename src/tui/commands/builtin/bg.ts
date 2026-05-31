import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";

export const bgCommand: LocalCommand = {
  kind: "local",
  name: "bg",
  description: "Manage background bash jobs",
  argumentHint: "[list|<cmd>|kill <id>|log <id>]",
  source: "builtin",
  async call(ctx: SlashCommandContext): Promise<LocalCommandResult> {
    const arg = ctx.args.trim();
    const { startJob, listJobs, getJob, killJob, formatJob } = await import("../../background.js");

    if (!arg || arg === "list") {
      const jobs = listJobs();
      return { type: "text", value: jobs.length === 0 ? "No background jobs." : "Background jobs:\n" + jobs.map(formatJob).join("\n") };
    }

    if (arg.startsWith("kill ")) {
      const id = arg.slice(5).trim();
      return { type: "text", value: killJob(id) ? `Killed job ${id}` : `Job ${id} not found or already finished` };
    }

    if (arg.startsWith("log ")) {
      const id = arg.slice(4).trim();
      const job = getJob(id);
      if (!job) return { type: "text", value: `Job ${id} not found` };
      const out = job.output.length > 4000 ? job.output.slice(-4000) + "\n[...output truncated to last 4000 chars]" : job.output;
      return { type: "text", value: `[${id}] ${job.command}\n${formatJob(job)}\n\n${out || "(no output yet)"}` };
    }

    const job = startJob(arg, ctx.cwd);
    return { type: "text", value: `Started background job [${job.id}]: ${arg}\nUse "/bg log ${job.id}" to view output, "/bg kill ${job.id}" to stop.` };
  },
};
