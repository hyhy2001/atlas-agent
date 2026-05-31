import type { LocalCommand, LocalCommandResult } from "../types.js";
import { listSessions } from "../../../sessions.js";

export const sessionsCommand: LocalCommand = {
  kind: "local",
  name: "sessions",
  description: "List saved sessions",
  source: "builtin",
  async call(): Promise<LocalCommandResult> {
    const sessions = await listSessions();
    if (!sessions.length) return { type: "text", value: "No saved sessions." };
    return {
      type: "text",
      value: sessions.map(s => {
        const title = s.title ? `  "${s.title}"` : "";
        return `  ${s.id}${title}  ${s.updatedAt.slice(0, 10)}  ${s.messageCount} msgs`;
      }).join("\n"),
    };
  },
};
