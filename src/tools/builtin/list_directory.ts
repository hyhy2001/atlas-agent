import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next", "__pycache__"]);
const MAX_ENTRIES = 1000;

interface ListInput {
  path: string;
  recursive?: boolean;
  max_depth?: number;
  include_hidden?: boolean;
}

async function listDir(
  dirPath: string,
  recursive: boolean,
  maxDepth: number,
  includeHidden: boolean,
  depth: number,
  entries: string[],
  indent: string
): Promise<void> {
  if (entries.length >= MAX_ENTRIES) return;

  let items;
  try {
    items = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  const dirs: { name: string; path: string }[] = [];
  const files: string[] = [];

  for (const item of items) {
    if (!includeHidden && item.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(item.name)) continue;

    if (item.isDirectory()) {
      dirs.push({ name: item.name, path: resolve(dirPath, item.name) });
    } else {
      files.push(item.name);
    }
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.localeCompare(b));

  for (const dir of dirs) {
    if (entries.length >= MAX_ENTRIES) {
      entries.push(`${indent}(truncated)`);
      return;
    }
    entries.push(`${indent}${dir.name}/`);
    if (recursive && depth < maxDepth) {
      await listDir(dir.path, recursive, maxDepth, includeHidden, depth + 1, entries, indent + "  ");
    }
  }

  for (const file of files) {
    if (entries.length >= MAX_ENTRIES) {
      entries.push(`${indent}(truncated)`);
      return;
    }
    entries.push(`${indent}${file}`);
  }
}

export const listDirectoryTool: ToolDefinition = {
  name: "list_directory",
  description:
    "List files and directories in a path. Use this to explore the project structure before reading specific files.",
  inputSchema: {
    properties: {
      path: { type: "string", description: "Directory path" },
      recursive: { type: "boolean", description: "Recurse into subdirectories (default false)" },
      max_depth: { type: "number", description: "Max recursion depth (default 3, only used if recursive=true)" },
      include_hidden: { type: "boolean", description: "Include dotfiles (default false)" },
    },
    required: ["path"],
  },
  isDestructive: false,

  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const { path, recursive = false, max_depth = 3, include_hidden = false } = input as ListInput;
    const fullPath = resolve(ctx.workingDir, path);

    try {
      const stat = await readdir(fullPath, { withFileTypes: true });
      if (!stat) {
        return { toolUseId: "", content: `Error: ${fullPath} is not a directory`, isError: true };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { toolUseId: "", content: `Error listing directory: ${msg}`, isError: true };
    }

    const entries: string[] = [];
    await listDir(fullPath, recursive, max_depth, include_hidden, 0, entries, "");

    if (entries.length === 0) {
      return { toolUseId: "", content: "(empty directory)", isError: false };
    }

    return { toolUseId: "", content: entries.join("\n"), isError: false };
  },
};
