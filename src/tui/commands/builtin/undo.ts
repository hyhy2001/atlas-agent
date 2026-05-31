import { promises as fs } from "node:fs";
import type { LocalCommand, LocalCommandResult } from "../types.js";

export const undoCommand: LocalCommand = {
  kind: "local",
  name: "undo",
  description: "Undo last tracked file edit",
  source: "builtin",
  async call(): Promise<LocalCommandResult> {
    const { popUndo } = await import("../../../undo.js");
    const entry = popUndo();
    if (!entry) return { type: "text", value: "Nothing to undo." };

    if (entry.previousContent === null) await fs.unlink(entry.path);
    else await fs.writeFile(entry.path, entry.previousContent, "utf-8");

    return {
      type: "text",
      value: entry.previousContent === null ? `Undo: deleted ${entry.path}` : `Undo: restored ${entry.path}`,
    };
  },
};
