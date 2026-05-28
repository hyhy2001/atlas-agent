import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ToolRegistry } from "../tools/registry.js";

export interface SubagentProfile {
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  restrictedTools?: string[];
  model?: string;
}

export const BUILTIN_SUBAGENTS: SubagentProfile[] = [
  {
    name: "code-reviewer",
    description: "Review code for bugs, style issues, and improvements",
    systemPrompt:
      "You are a code reviewer. Analyze the code provided and give feedback on: bugs, security issues, performance problems, style inconsistencies, and suggestions for improvement. Use read_file and grep to examine code. Do NOT modify any files.",
    allowedTools: ["read_file", "grep", "list_directory"],
    restrictedTools: ["write_file", "edit_file", "bash"],
  },
  {
    name: "test-writer",
    description: "Write tests for existing code",
    systemPrompt:
      "You are a test engineer. Write comprehensive tests for the code the user points you to. Use read_file to understand the code, then write tests using write_file. Run tests with bash to verify they pass.",
    allowedTools: [],
    restrictedTools: [],
  },
  {
    name: "explainer",
    description: "Explain code in detail",
    systemPrompt:
      "You are a code explainer. Read the code the user asks about and explain it clearly. Use diagrams (ASCII), analogies, and step-by-step breakdowns. Focus on the 'why' not just the 'what'. Do NOT modify any files.",
    allowedTools: ["read_file", "grep", "list_directory"],
    restrictedTools: ["write_file", "edit_file", "bash"],
  },
  {
    name: "refactorer",
    description: "Suggest and apply refactoring improvements",
    systemPrompt:
      "You are a refactoring specialist. Analyze code structure and suggest improvements: extract functions, reduce duplication, improve naming, simplify logic. When the user approves, apply the changes.",
    allowedTools: [],
    restrictedTools: [],
  },
];

export function getSubagent(name: string): SubagentProfile | undefined {
  return BUILTIN_SUBAGENTS.find((s) => s.name === name);
}

export function listSubagents(): SubagentProfile[] {
  return [...BUILTIN_SUBAGENTS];
}

export function filterRegistryForSubagent(
  registry: ToolRegistry,
  profile: SubagentProfile
): ToolRegistry {
  const filtered = new ToolRegistry();
  const allTools = registry.getAll();

  const restricted = new Set(profile.restrictedTools ?? []);
  const allowed = new Set(profile.allowedTools);
  const hasAllowList = allowed.size > 0;

  for (const tool of allTools) {
    if (restricted.has(tool.name)) {
      continue;
    }
    if (hasAllowList && !allowed.has(tool.name)) {
      continue;
    }
    filtered.register(tool);
  }

  return filtered;
}

export async function loadCustomSubagents(cwd: string): Promise<SubagentProfile[]> {
  const results: Map<string, SubagentProfile> = new Map();

  const home = os.homedir();
  const globalDir = path.join(home, ".atlas", "agents");
  const localDir = path.join(cwd, ".atlas", "agents");

  async function readDirIfExists(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        if (!e.name.endsWith(".md")) continue;
        const filePath = path.join(dir, e.name);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          const profile = parseSubagentFile(content, filePath);
          results.set(profile.name, profile);
        } catch {
          // ignore individual file errors
        }
      }
    } catch {
      // dir not exist or unreadable: ignore
    }
  }

  await readDirIfExists(globalDir);
  await readDirIfExists(localDir);

  return Array.from(results.values());
}

export function parseSubagentFile(content: string, filePath: string): SubagentProfile {
  const basename = path.basename(filePath, ".md");
  let name = basename;
  let description = "";
  let allowedTools: string[] = [];
  let restrictedTools: string[] = [];
  let model: string | undefined;
  let systemPrompt = content;

  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const m = content.match(fmRegex);
  if (m) {
    const fm = m[1];
    const lines = fm.split(/\r?\n/);
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key === "name" && val) {
        name = val;
      } else if (key === "description" && val) {
        description = val;
      } else if (key === "allowed_tools" && val) {
        allowedTools = val.split(",").map((s) => s.trim()).filter(Boolean);
      } else if (key === "restricted_tools" && val) {
        restrictedTools = val.split(",").map((s) => s.trim()).filter(Boolean);
      } else if (key === "model" && val) {
        model = val;
      }
    }
    systemPrompt = content.slice(m[0].length);
  }

  systemPrompt = systemPrompt.replace(/^﻿/, "").trim();

  return { name, description, systemPrompt, allowedTools, restrictedTools, model };
}
