import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";
import { formatTokenCount } from "../../format.js";

export const costCommand: LocalCommand = {
  kind: "local",
  name: "cost",
  description: "Show token usage and estimated cost for this session",
  source: "builtin",
  call(ctx: SlashCommandContext): LocalCommandResult {
    const app = ctx.app ?? {};
    const tokens = (app["tokens"] as { input: number; output: number; cached: number }) ?? { input: 0, output: 0, cached: 0 };
    const mainModel = (app["mainModel"] as string) ?? "";
    const fastModel = (app["fastModel"] as string) ?? mainModel;
    const reasoningModel = (app["reasoningModel"] as string) ?? mainModel;

    const inCost = (tokens.input / 1_000_000) * 1.5;
    const outCost = (tokens.output / 1_000_000) * 15.0;
    const total = tokens.input + tokens.output;
    const cacheHitPct = tokens.input > 0 ? ((tokens.cached / tokens.input) * 100).toFixed(1) : "0.0";

    const lines = [
      `Token usage this session:`,
      `  Input:     ${formatTokenCount(tokens.input)} tokens  (~$${inCost.toFixed(4)})`,
      `  Output:    ${formatTokenCount(tokens.output)} tokens  (~$${outCost.toFixed(4)})`,
      `  Total:     ${formatTokenCount(total)} tokens  (~$${(inCost + outCost).toFixed(4)})`,
      tokens.cached > 0
        ? `  Cached:    ${formatTokenCount(tokens.cached)} tokens  (${cacheHitPct}% cache hit)`
        : `  Cached:    0 tokens  (no cache hits yet — proxy may not support prompt caching)`,
      ``,
      `Model tiers:`,
      `  leader:    ${mainModel}`,
      `  fast:      ${fastModel}`,
      `  reasoning: ${reasoningModel}`,
    ];

    return { type: "text", value: lines.join("\n") };
  },
};
