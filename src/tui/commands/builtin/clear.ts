import type { LocalCommand, LocalCommandResult } from "../types.js";

export const clearCommand: LocalCommand = {
  kind: "local",
  name: "clear",
  description: "Clear conversation history and free up context",
  aliases: ["reset", "new"],
  source: "builtin",
  call(): LocalCommandResult {
    return { type: "clear" };
  },
};
