import type { SlashCommand } from "./types.js";

// Suggestion item shape — what the prompt input renders in its dropdown.
export interface CommandSuggestion {
  command: SlashCommand;
  // Highlight indices for fuzzy matches (positions in `name` to bold/color).
  indices?: number[];
  // Score for sort stability — lower = better match.
  score: number;
}

// Slash command registry. Holds built-ins + user/project/skill commands and
// resolves names + provides ranked suggestions for typeahead.
//
// Resolution order for exact match:
//   1. Canonical name match (case-insensitive)
//   2. Alias match
//
// For empty-query suggestions (just `/`), returns commands grouped by source
// in the order: builtin → project → user → skill → plugin. cc-ref groups by
// frequency-of-use too — we skip that for v1.
export class SlashCommandRegistry {
  private commands: SlashCommand[] = [];
  private byName = new Map<string, SlashCommand>();

  register(cmd: SlashCommand): void {
    // Last registration wins — lets project commands override user, user override builtin.
    const key = cmd.name.toLowerCase();
    const prev = this.byName.get(key);
    if (prev) {
      const idx = this.commands.indexOf(prev);
      if (idx >= 0) this.commands.splice(idx, 1);
    }
    this.commands.push(cmd);
    this.byName.set(key, cmd);
    for (const alias of cmd.aliases ?? []) {
      this.byName.set(alias.toLowerCase(), cmd);
    }
  }

  registerAll(cmds: SlashCommand[]): void {
    for (const c of cmds) this.register(c);
  }

  find(name: string): SlashCommand | undefined {
    // Strip leading slash if present, lowercase.
    const key = name.replace(/^\//, "").trim().toLowerCase();
    if (!key) return undefined;
    return this.byName.get(key);
  }

  // All non-hidden commands, sorted alphabetically by name. Used for `/`-only
  // suggestion (no query yet).
  list(): SlashCommand[] {
    return this.commands.filter(c => !c.hidden).sort((a, b) => a.name.localeCompare(b.name));
  }

  // Rank suggestions for a query (without leading slash).
  //
  //   - Exact name match wins (score 0).
  //   - Prefix name match (score 1, +position penalty).
  //   - Prefix alias match (score 2).
  //   - Substring match (score 3).
  //   - Fuzzy subsequence match (score 4 + gap penalty).
  //
  // Limit defaults to 10 to keep the dropdown short.
  search(query: string, limit = 10): CommandSuggestion[] {
    const q = query.replace(/^\//, "").trim().toLowerCase();
    if (!q) {
      return this.list().slice(0, limit).map(command => ({ command, score: 0 }));
    }

    const out: CommandSuggestion[] = [];
    for (const cmd of this.commands) {
      if (cmd.hidden) continue;
      const name = cmd.name.toLowerCase();
      const aliases = (cmd.aliases ?? []).map(a => a.toLowerCase());

      if (name === q) {
        out.push({ command: cmd, score: 0, indices: range(0, name.length) });
        continue;
      }
      if (name.startsWith(q)) {
        out.push({ command: cmd, score: 1, indices: range(0, q.length) });
        continue;
      }
      const aliasPrefix = aliases.find(a => a.startsWith(q));
      if (aliasPrefix) {
        out.push({ command: cmd, score: 2 });
        continue;
      }
      const subIdx = name.indexOf(q);
      if (subIdx >= 0) {
        out.push({ command: cmd, score: 3 + subIdx, indices: range(subIdx, subIdx + q.length) });
        continue;
      }
      const fuzzy = fuzzyMatch(name, q);
      if (fuzzy) {
        out.push({ command: cmd, score: 4 + fuzzy.gap, indices: fuzzy.indices });
      }
    }

    out.sort((a, b) => a.score - b.score || a.command.name.localeCompare(b.command.name));
    return out.slice(0, limit);
  }
}

function range(start: number, end: number): number[] {
  const r: number[] = [];
  for (let i = start; i < end; i++) r.push(i);
  return r;
}

// Subsequence fuzzy match. Returns matched indices + total gap (for sort).
// Walks `query` left-to-right through `text`, recording each landed index.
// A query char that can't be found in remaining text → no match.
function fuzzyMatch(text: string, query: string): { indices: number[]; gap: number } | null {
  const indices: number[] = [];
  let ti = 0;
  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi];
    while (ti < text.length && text[ti] !== ch) ti++;
    if (ti >= text.length) return null;
    indices.push(ti);
    ti++;
  }
  // Gap = total skipped chars between matched positions. Tighter clusters score better.
  let gap = 0;
  for (let i = 1; i < indices.length; i++) {
    gap += indices[i]! - indices[i - 1]! - 1;
  }
  return { indices, gap };
}
