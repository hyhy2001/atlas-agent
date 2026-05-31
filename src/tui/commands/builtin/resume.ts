import type { LocalCommand } from "../types.js";

export const resumeCommand: LocalCommand = {
  kind: "local",
  name: "resume",
  description: "Resume a previously saved session",
  source: "builtin",
  async call(ctx) {
    const msg = await (ctx.app?.["resumeSession"] as () => Promise<string>)?.();
    return { type: "text", value: msg ?? "Done" };
  },
};
