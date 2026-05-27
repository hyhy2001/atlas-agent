import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export interface CustomCommand {
  name: string;
  description: string;
  promptBody: string;
  source: string;
}

export async function loadCommands(cwd: string): Promise<CustomCommand[]> {
  const results: Map<string, CustomCommand> = new Map();

  const home = os.homedir();
  const globalDir = path.join(home, ".atlas", "commands");
  const localDir = path.join(cwd, ".atlas", "commands");

  async function readDirIfExists(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        if (!e.name.endsWith(".md")) continue;
        const filePath = path.join(dir, e.name);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          const cmd = parseCommandFile(content, filePath);
          // For global first then local override, we insert/overwrite in that order.
          results.set(cmd.name, cmd);
        } catch (err) {
          // ignore individual file errors
        }
      }
    } catch (err) {
      // dir not exist or unreadable: ignore
    }
  }

  // Read global first
  await readDirIfExists(globalDir);
  // Then local (overrides)
  await readDirIfExists(localDir);

  const arr = Array.from(results.values());
  arr.sort((a, b) => a.name.localeCompare(b.name));
  return arr;
}

export function parseCommandFile(content: string, filePath: string): CustomCommand {
  const basename = path.basename(filePath, ".md");
  let name = basename;
  let description = "";
  let promptBody = content;

  // Detect frontmatter only if file starts with ---\n
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const m = content.match(fmRegex);
  if (m) {
    const fm = m[1];
    // parse simple key: value lines
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
      }
    }
    promptBody = content.slice(m[0].length);
  }

  promptBody = promptBody.replace(/^﻿/, "");
  promptBody = promptBody.trim();

  return {
    name,
    description,
    promptBody,
    source: filePath,
  };
}
