import { readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";

export function createCompleter(params: {
  commands: string[];
  subagentNames: string[];
  cwd: string;
}) {
  return function completer(line: string): [string[], string] {
    const { commands, subagentNames, cwd } = params;

    // Slash command completion
    if (line.startsWith("/")) {
      // /agent <name> completion
      if (line.startsWith("/agent ")) {
        const partial = line.slice(7);
        const hits = subagentNames.filter(n => n.startsWith(partial));
        return [hits.map(n => `/agent ${n}`), line];
      }
      // General slash command completion
      const partial = line.slice(1);
      const hits = commands.filter(c => c.startsWith(partial));
      return [hits.map(c => `/${c}`), line];
    }

    // @-mention file completion
    const atIdx = line.lastIndexOf("@");
    if (atIdx !== -1) {
      const partial = line.slice(atIdx + 1);
      const dir = partial.includes("/") ? join(cwd, dirname(partial)) : cwd;
      const prefix = partial.includes("/") ? dirname(partial) + "/" : "";
      const filePrefix = basename(partial);

      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        const hits = entries
          .filter(e => e.name.startsWith(filePrefix) && !e.name.startsWith("."))
          .map(e => line.slice(0, atIdx + 1) + prefix + e.name + (e.isDirectory() ? "/" : ""));
        return [hits, line];
      } catch {
        return [[], line];
      }
    }

    return [[], line];
  };
}
