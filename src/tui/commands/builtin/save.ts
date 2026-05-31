import type { LocalCommand } from "../types.js";

export const saveCommand: LocalCommand = {
  kind: "local",
  name: "save",
  description: "Save current session to disk",
  source: "builtin",
  async call(ctx) {
    const id = await (ctx.app?.["saveSession"] as () => Promise<string>)?.();
    return { type: "text", value: `Session saved: ${id ?? "unknown"}` };
  },
};
