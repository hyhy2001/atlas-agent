import type { LocalCommand, LocalCommandResult } from "../types.js";

export const versionCommand: LocalCommand = {
  kind: "local",
  name: "version",
  description: "Show Atlas version",
  source: "builtin",
  call(): LocalCommandResult {
    return { type: "text", value: "Atlas v1.0.0" };
  },
};
