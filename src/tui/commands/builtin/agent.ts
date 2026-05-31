import type { LocalCommand } from "../types.js";

export const agentCommand: LocalCommand = {
  kind: "local",
  name: "agent",
  description: "Run a task with a specific subagent",
  argumentHint: "<name> [prompt]",
  source: "builtin",
  async call(ctx) {
    const args = ctx.args.trim();
    const subagents = ctx.app?.["subagents"] as Array<{name: string; description: string}> ?? [];
    if (!args) {
      const list = subagents.map(a => `  ${a.name}  — ${a.description}`).join("\n");
      return { type: "text", value: `Usage: /agent <name> <prompt>\nAvailable agents:\n${list}` };
    }
    const spaceIdx = args.indexOf(" ");
    const name = spaceIdx === -1 ? args : args.slice(0, spaceIdx);
    const prompt = spaceIdx === -1 ? "" : args.slice(spaceIdx + 1).trim();
    if (!prompt) {
      (ctx.app?.["setPendingAgent"] as (n: string) => void)?.(name);
      return { type: "skip" };
    }
    await (ctx.app?.["runAgent"] as (n: string, p: string) => Promise<string>)?.(name, prompt);
    return { type: "skip" };
  },
};
