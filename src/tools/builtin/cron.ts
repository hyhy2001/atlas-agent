import path from "node:path";
import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";
import { getCronScheduler } from "../../cron/scheduler.js";

function scheduler(ctx: ExecutionContext) {
  return getCronScheduler(path.join(ctx.workingDir, ".atlas", "cron.json"));
}

function ok(content: string): ToolResult {
  return { toolUseId: "", content, isError: false };
}

function err(content: string): ToolResult {
  return { toolUseId: "", content, isError: true };
}

export const cronCreateTool: ToolDefinition = {
  name: "cron_create",
  description: "Create a scheduled prompt using a cron expression.",
  inputSchema: {
    properties: {
      cron: { type: "string", description: "5-field cron expression" },
      prompt: { type: "string", description: "Prompt to enqueue when schedule fires" },
      recurring: { type: "boolean", description: "Whether this schedule repeats" },
      durable: { type: "boolean", description: "Persist this job across restarts" },
    },
    required: ["cron", "prompt"],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { cron, prompt, recurring, durable } = input as {
      cron: string;
      prompt: string;
      recurring?: boolean;
      durable?: boolean;
    };
    try {
      const job = scheduler(ctx).add({ cron, prompt, recurring, durable });
      return ok(`Scheduled job #${job.id}: ${job.cron} (next fire: ${job.nextFireAt})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(message);
    }
  },
};

export const cronListTool: ToolDefinition = {
  name: "cron_list",
  description: "List all scheduled prompt jobs.",
  inputSchema: { properties: {}, required: [] },
  isDestructive: false,
  async execute(_input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const jobs = scheduler(ctx).list();
    if (jobs.length === 0) return ok("No scheduled jobs.");
    const lines = jobs.map((job) => {
      const recurringText = job.recurring ? " (recurring)" : "";
      const durableText = job.durable ? " [durable]" : "";
      const promptSnippet = job.prompt.slice(0, 50);
      return `#${job.id} ${job.cron} — next: ${job.nextFireAt}${recurringText}${durableText} — "${promptSnippet}"`;
    });
    return ok(lines.join("\n"));
  },
};

export const cronDeleteTool: ToolDefinition = {
  name: "cron_delete",
  description: "Delete a scheduled prompt job by ID.",
  inputSchema: {
    properties: {
      id: { type: "string", description: "Job ID to delete" },
    },
    required: ["id"],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { id } = input as { id: string };
    const removed = scheduler(ctx).remove(id);
    if (removed) return ok(`Deleted scheduled job #${id}`);
    return err(`Scheduled job #${id} not found`);
  },
};
