import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "./paths.js";

export interface Skill {
  name: string;
  description: string;
  promptBody: string;
  source: string;
  args?: string[];
}

export function parseSkillFile(content: string, filePath: string): Skill {
  const baseName = path.basename(filePath, ".md");
  let name = baseName;
  let description = "";
  let promptBody = content;
  let args: string[] | undefined;

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
      if (key === "name" && val) name = val;
      else if (key === "description" && val) description = val;
      else if (key === "args" && val) {
        const inner = val.replace(/^\[/, "").replace(/\]$/, "");
        args = inner.split(",").map(s => s.trim()).filter(Boolean);
      }
    }
    promptBody = content.slice(m[0].length);
  }

  promptBody = promptBody.replace(/^﻿/, "").trim();
  return { name, description, promptBody, source: filePath, args };
}

async function readSkillDir(dir: string, results: Map<string, Skill>): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const filePath = path.join(dir, e.name);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const skill = parseSkillFile(content, filePath);
        results.set(skill.name, skill);
      } catch {
        // ignore individual file errors
      }
    }
  } catch {
    // dir doesn't exist
  }
}

export async function loadSkills(cwd: string): Promise<Skill[]> {
  const results = new Map<string, Skill>();

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const bundledCandidates = [
    path.join(moduleDir, "skills", "bundled"),
    path.join(moduleDir, "..", "src", "skills", "bundled"),
    path.join(moduleDir, "..", "..", "src", "skills", "bundled"),
  ];
  for (const c of bundledCandidates) {
    await readSkillDir(c, results);
  }

  await readSkillDir(paths.skills(), results);
  await readSkillDir(path.join(cwd, ".atlas", "skills"), results);

  const arr = Array.from(results.values());
  arr.sort((a, b) => a.name.localeCompare(b.name));
  return arr;
}

export function formatSkillsForSystemPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  let out = "\n\n# Available Skills\n\n";
  out += "Skills are workflows you can invoke. When a user request matches a skill, apply its workflow. Users may also invoke one explicitly with /<skill-name> [args].\n\n";
  for (const s of skills) {
    out += `## /${s.name}\n${s.description}\n\n${s.promptBody}\n\n`;
  }
  return out;
}
