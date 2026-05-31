import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";

export const modelCommand: LocalCommand = {
  kind: "local",
  name: "model",
  description: "Show or set the AI model",
  argumentHint: "[main|fast|reasoning] [model-name]",
  source: "builtin",
  call(ctx: SlashCommandContext): LocalCommandResult {
    const arg = ctx.args.trim();
    if (!arg) {
      const mainModel = ctx.app?.["mainModel"] as string ?? "unknown";
      const fastModel = ctx.app?.["fastModel"] as string ?? "(uses main)";
      const reasoningModel = ctx.app?.["reasoningModel"] as string ?? "(uses main)";
      return {
        type: "text",
        value: [
          `Models:`,
          `  leader:    ${mainModel}`,
          `  fast:      ${fastModel}`,
          `  reasoning: ${reasoningModel}`,
          ``,
          `Usage: /model [main|fast|reasoning] <model-name>`,
        ].join("\n"),
      };
    }
    const parts = arg.split(/\s+/);
    const tier = (parts[0] === "fast" || parts[0] === "reasoning" || parts[0] === "main") ? parts[0] : "main";
    const newModel = tier === "main" && parts[0] !== "main" ? arg : parts.slice(1).join(" ").trim();
    if (!newModel) return { type: "text", value: `Usage: /model ${tier} <name>` };
    const setModel = ctx.app?.["setModel"] as ((tier: string, name: string) => void) | undefined;
    setModel?.(tier, newModel);
    return { type: "text", value: `${tier} model: ${newModel}` };
  },
};
