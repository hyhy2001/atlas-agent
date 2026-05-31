import type { LocalCommand } from "../types.js";

export const loadCommand: LocalCommand = {
  kind: "local",
  name: "load",
  description: "Load a saved session by ID",
  argumentHint: "<session-id>",
  source: "builtin",
  async call(ctx) {
    const id = ctx.args.trim();
    if (!id) return { type: "text", value: "Usage: /load <session-id>" };
    const msg = await (ctx.app?.["loadSession"] as (id: string) => Promise<string>)?.(id);
    return { type: "text", value: msg ?? "Done" };
  },
};
