import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";
import { getTaskStore, type TaskUpdatePatch } from "../../tasks/store.js";

interface TaskSummary {
  id: string;
  subject: string;
  status: string;
  owner?: string;
  blockedBy: string[];
}

function taskSummary(t: TaskSummary): string {
  const blocked = t.blockedBy.length > 0 ? ` [blocked by: ${t.blockedBy.map(b => "#" + b).join(", ")}]` : "";
  const owner = t.owner ? ` (${t.owner})` : "";
  return `#${t.id} [${t.status}]${owner} ${t.subject}${blocked}`;
}

export const taskCreateTool: ToolDefinition = {
  name: "task_create",
  description: "Create a new task to track work. Returns the task ID.",
  inputSchema: {
    properties: {
      subject: { type: "string", description: "Brief title for the task" },
      description: { type: "string", description: "What needs to be done" },
      activeForm: { type: "string", description: "Present continuous form shown while in_progress (e.g. 'Running tests')" },
      metadata: { type: "object", description: "Optional key-value metadata" },
    },
    required: ["subject", "description"],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { subject, description, activeForm, metadata } = input as { subject: string; description: string; activeForm?: string; metadata?: Record<string, unknown> };
    const store = await getTaskStore(ctx.workingDir);
    const task = store.create({ subject, description, activeForm, metadata });
    return { toolUseId: "", content: `Task #${task.id} created: ${task.subject}`, isError: false };
  },
};

export const taskGetTool: ToolDefinition = {
  name: "task_get",
  description: "Get full details of a task by ID.",
  inputSchema: {
    properties: {
      taskId: { type: "string", description: "Task ID (e.g. '1')" },
    },
    required: ["taskId"],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { taskId } = input as { taskId: string };
    const store = await getTaskStore(ctx.workingDir);
    const task = store.get(taskId);
    if (!task) return { toolUseId: "", content: `Task #${taskId} not found`, isError: true };
    const lines = [
      `Task #${task.id}: ${task.subject}`,
      `Status: ${task.status}${task.activeForm ? ` (${task.activeForm})` : ""}`,
      `Owner: ${task.owner ?? "(none)"}`,
      `Description: ${task.description}`,
      task.blocks.length ? `Blocks: ${task.blocks.map(b => "#" + b).join(", ")}` : "",
      task.blockedBy.length ? `Blocked by: ${task.blockedBy.map(b => "#" + b).join(", ")}` : "",
      task.metadata ? `Metadata: ${JSON.stringify(task.metadata)}` : "",
    ].filter(Boolean);
    return { toolUseId: "", content: lines.join("\n"), isError: false };
  },
};

export const taskListTool: ToolDefinition = {
  name: "task_list",
  description: "List all active tasks (excludes deleted). Shows id, status, owner, subject, blockedBy.",
  inputSchema: { properties: {}, required: [] },
  isDestructive: false,
  async execute(_input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const store = await getTaskStore(ctx.workingDir);
    const tasks = store.list();
    if (tasks.length === 0) return { toolUseId: "", content: "No tasks.", isError: false };
    const lines = tasks.map(t => taskSummary(t));
    return { toolUseId: "", content: `Tasks (${tasks.length}):\n${lines.join("\n")}`, isError: false };
  },
};

export const taskUpdateTool: ToolDefinition = {
  name: "task_update",
  description: "Update a task's status, subject, description, owner, or dependencies.",
  inputSchema: {
    properties: {
      taskId: { type: "string", description: "Task ID to update" },
      status: { type: "string", enum: ["pending", "in_progress", "completed", "deleted"], description: "New status" },
      subject: { type: "string", description: "New subject" },
      description: { type: "string", description: "New description" },
      activeForm: { type: "string", description: "New activeForm" },
      owner: { type: "string", description: "New owner" },
      addBlocks: { type: "array", items: { type: "string" }, description: "Task IDs this task now blocks" },
      addBlockedBy: { type: "array", items: { type: "string" }, description: "Task IDs that must complete before this one" },
      metadata: { type: "object", description: "Metadata keys to merge" },
    },
    required: ["taskId"],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { taskId, ...rest } = input as { taskId: string } & TaskUpdatePatch;
    const store = await getTaskStore(ctx.workingDir);
    const task = store.update(taskId, rest);
    if (!task) return { toolUseId: "", content: `Task #${taskId} not found`, isError: true };
    return { toolUseId: "", content: `Task #${task.id} updated: ${task.subject} [${task.status}]`, isError: false };
  },
};

export const taskDeleteTool: ToolDefinition = {
  name: "task_delete",
  description: "Delete a task (marks as deleted, not removed from store).",
  inputSchema: {
    properties: {
      taskId: { type: "string", description: "Task ID to delete" },
    },
    required: ["taskId"],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { taskId } = input as { taskId: string };
    const store = await getTaskStore(ctx.workingDir);
    const ok = store.delete(taskId);
    if (!ok) return { toolUseId: "", content: `Task #${taskId} not found`, isError: true };
    return { toolUseId: "", content: `Task #${taskId} deleted`, isError: false };
  },
};
