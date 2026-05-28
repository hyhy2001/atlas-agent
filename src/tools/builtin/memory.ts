import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";
import { loadAllMemory, saveMemory, appendMemory, deleteMemory, type MemoryEntry } from "../../memory.js";

const TYPES = ["user", "project", "feedback", "reference"] as const;

export const memorySaveTool: ToolDefinition = {
  name: "memory_save",
  description: "Save or replace a memory entry. Use sparingly — only for facts/preferences that should persist across sessions.",
  inputSchema: {
    properties: {
      type: { type: "string", enum: TYPES, description: "Memory category" },
      content: { type: "string", description: "Full content to save (replaces existing)" },
    },
    required: ["type", "content"],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { type, content } = input as { type: MemoryEntry["type"]; content: string };
    const path = await saveMemory(ctx.workingDir, type, content);
    return { toolUseId: "", content: `Memory saved: ${path}`, isError: false };
  },
};

export const memoryAppendTool: ToolDefinition = {
  name: "memory_append",
  description: "Append a new entry to memory without replacing existing content.",
  inputSchema: {
    properties: {
      type: { type: "string", enum: TYPES },
      entry: { type: "string", description: "New entry to append" },
    },
    required: ["type", "entry"],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { type, entry } = input as { type: MemoryEntry["type"]; entry: string };
    const path = await appendMemory(ctx.workingDir, type, entry);
    return { toolUseId: "", content: `Appended to memory: ${path}`, isError: false };
  },
};

export const memoryReadTool: ToolDefinition = {
  name: "memory_read",
  description: "Read all memory entries.",
  inputSchema: { properties: {}, required: [] },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const entries = await loadAllMemory(ctx.workingDir);
    if (entries.length === 0) return { toolUseId: "", content: "No memory entries.", isError: false };
    const formatted = entries.map(e => `## ${e.type}\n${e.content}`).join("\n\n");
    return { toolUseId: "", content: formatted, isError: false };
  },
};

export const memoryDeleteTool: ToolDefinition = {
  name: "memory_delete",
  description: "Delete a memory category.",
  inputSchema: {
    properties: {
      type: { type: "string", enum: TYPES },
    },
    required: ["type"],
  },
  isDestructive: true,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { type } = input as { type: MemoryEntry["type"] };
    const ok = await deleteMemory(ctx.workingDir, type);
    return { toolUseId: "", content: ok ? `Deleted ${type}.md` : `No memory found for type: ${type}`, isError: false };
  },
};
