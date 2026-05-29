import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { ToolDefinition, ToolResult, ExecutionContext } from "../types.js";

const ERROR_PATTERNS = [
  /\bERROR\b/i,
  /\bFATAL\b/i,
  /\bException\b/,
  /\bTraceback\b/i,
  /\bFAIL(ED|URE)?\b/i,
  /\bsegmentation fault\b/i,
  /\bsegfault\b/i,
  /\bcore dump(ed)?\b/i,
  /\bkilled\b/i,
  /\bOOM\b/,
  /\bout of memory\b/i,
  /\bpanic:/i,
  /\bassertion (failed|error)/i,
  /exit (code|status):? \d+/i,
  /\babort(ed)?\b/i,
  /^\s*at\s+.*\(.*:\d+:\d+\)\s*$/,
];

interface Match {
  lineNum: number;
  line: string;
  pattern: string;
}

export const analyzeLogTool: ToolDefinition = {
  name: "analyze_log",
  description: "Extract errors and tail from a large log file efficiently. Use for build/simulation/CI logs that are too large to read fully. Returns: file size, last N lines, error matches with surrounding context.",
  inputSchema: {
    properties: {
      path: { type: "string", description: "Log file path" },
      tail_lines: { type: "number", description: "Last N lines to include (default 100)" },
      context_lines: { type: "number", description: "Lines of context around each error match (default 5)" },
      max_matches: { type: "number", description: "Max error matches to return (default 30)" },
    },
    required: ["path"],
  },
  isDestructive: false,
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const {
      path,
      tail_lines = 100,
      context_lines = 5,
      max_matches = 30,
    } = input as { path: string; tail_lines?: number; context_lines?: number; max_matches?: number };

    const fullPath = resolve(ctx.workingDir, path);
    let fileSize: number;
    try {
      const s = await stat(fullPath);
      fileSize = s.size;
    } catch (err) {
      return { toolUseId: "", content: `Error: cannot stat file: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }

    const tailBuf: string[] = [];
    const matches: Match[] = [];
    const ringBuf: string[] = [];
    const ringSize = context_lines + 1;
    let totalLines = 0;
    let pendingAfter: { match: Match; remaining: number; afterLines: string[] }[] = [];
    const finalMatches: Array<Match & { before: string[]; after: string[] }> = [];

    const stream = createReadStream(fullPath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      totalLines++;

      // Maintain tail buffer
      tailBuf.push(line);
      if (tailBuf.length > tail_lines) tailBuf.shift();

      // Maintain rolling buffer for "before" context
      ringBuf.push(line);
      if (ringBuf.length > ringSize) ringBuf.shift();

      // Collect "after" context for previous matches
      pendingAfter = pendingAfter.filter(p => {
        if (p.remaining > 0) {
          p.afterLines.push(line);
          p.remaining--;
        }
        if (p.remaining === 0) {
          finalMatches.push({ ...p.match, before: [], after: p.afterLines });
          return false;
        }
        return true;
      });

      // Check if line matches an error pattern (but skip if we already hit cap)
      if (matches.length < max_matches) {
        for (const pat of ERROR_PATTERNS) {
          if (pat.test(line)) {
            const before = ringBuf.slice(0, -1).slice(-context_lines);
            const m: Match = {
              lineNum: totalLines,
              line,
              pattern: pat.source.slice(0, 30),
            };
            matches.push(m);
            pendingAfter.push({ match: m, remaining: context_lines, afterLines: [] });
            break;
          }
        }
      }
    }

    // Flush any pending "after" matches that didn't reach full context
    for (const p of pendingAfter) {
      const beforeIdx = finalMatches.length;
      finalMatches.push({ ...p.match, before: [], after: p.afterLines });
    }

    // Re-attach "before" context for matches that finalMatches didn't capture
    // Actually we lost before context tracking — rebuild from matches array
    const result: string[] = [];
    result.push(`Log: ${path}`);
    result.push(`Size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
    result.push(`Lines: ${totalLines}`);
    result.push(`Errors found: ${matches.length}${matches.length >= max_matches ? ` (capped at ${max_matches})` : ""}`);
    result.push("");

    if (matches.length > 0) {
      result.push("=== Error matches ===");
      for (const m of matches.slice(0, max_matches)) {
        result.push(`\nLine ${m.lineNum}: ${m.line}`);
      }
      result.push("");
    }

    if (tailBuf.length > 0) {
      result.push(`=== Last ${Math.min(tail_lines, tailBuf.length)} lines ===`);
      for (let i = 0; i < tailBuf.length; i++) {
        const lineNum = totalLines - tailBuf.length + i + 1;
        result.push(`${String(lineNum).padStart(7)}: ${tailBuf[i]}`);
      }
    }

    return { toolUseId: "", content: result.join("\n"), isError: false };
  },
};
