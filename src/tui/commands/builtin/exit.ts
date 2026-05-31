import type { LocalCommand, LocalCommandResult } from "../types.js";

export const exitCommand: LocalCommand = {
  kind: "local",
  name: "exit",
  description: "Exit Atlas",
  aliases: ["quit"],
  source: "builtin",
  hidden: true,
  call(): LocalCommandResult {
    return { type: "exit" };
  },
};
