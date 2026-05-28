import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";

interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
}

const todoStore = new Map<string, TodoItem[]>();

function formatTodos(todos: TodoItem[]): string {
  if (todos.length === 0) return "Todo list is empty.";
  const icons = { pending: "○", in_progress: "●", completed: "✓" };
  const priorities = { high: "HIGH", medium: "MED ", low: "LOW " };
  const lines = todos.map(t => `  [${icons[t.status]}] ${priorities[t.priority]}  ${t.content}`);
  return `Todo list (${todos.length} items):\n${lines.join("\n")}`;
}

export const todoReadTool: ToolDefinition = {
  name: "todo_read",
  description: "Read the current todo list for this session.",
  inputSchema: { properties: {}, required: [] },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const todos = todoStore.get(ctx.workingDir) ?? [];
    return { toolUseId: "", content: formatTodos(todos), isError: false };
  },
};

export const todoWriteTool: ToolDefinition = {
  name: "todo_write",
  description: "Update the todo list. Use to track tasks, mark items complete, and stay organized.",
  inputSchema: {
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            content: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
            priority: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["id", "content", "status", "priority"],
        },
        description: "Array of todo items",
      },
    },
    required: ["todos"],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { todos } = input as { todos: TodoItem[] };
    todoStore.set(ctx.workingDir, todos);
    return { toolUseId: "", content: `Updated todo list (${todos.length} items).`, isError: false };
  },
};
