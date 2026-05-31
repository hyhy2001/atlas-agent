import type { LocalCommand } from "../types.js";

export const compactCommand: LocalCommand = {
  kind: "local",
  name: "compact",
  description: "Summarize conversation history to free up context",
  source: "builtin",
  async call(ctx) {
    ctx.addSystem("Compacting conversation...");
    const msg = await (ctx.app?.["compact"] as () => Promise<string>)?.();
    return { type: "text", value: msg ?? "Done" };
  },
};
