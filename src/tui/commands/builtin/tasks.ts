import type { LocalCommand, LocalCommandResult, SlashCommandContext } from "../types.js";

export const tasksCommand: LocalCommand = {
  kind: "local",
  name: "tasks",
  description: "List saved tasks in current workspace",
  source: "builtin",
  async call(ctx: SlashCommandContext): Promise<LocalCommandResult> {
    const { getTaskStore } = await import("../../../tasks/store.js");
    const store = await getTaskStore(ctx.cwd);
    const tasks = store.list();

    if (tasks.length === 0) return { type: "text", value: "No tasks." };

    const lines = tasks.map(t => {
      const blocked = t.blockedBy.length > 0 ? `  [blocked by: ${t.blockedBy.map(b => "#" + b).join(", ")}]` : "";
      const owner = t.owner ? `  (${t.owner})` : "";
      return `  #${t.id} [${t.status}]${owner} ${t.subject}${blocked}`;
    });

    return { type: "text", value: `Tasks (${tasks.length}):\n${lines.join("\n")}` };
  },
};
