import chalk from "chalk";
import { highlight as cliHighlight } from "cli-highlight";
// Force colors for non-tty environments (tests)
;(chalk as any).level = 3;

export function getLanguage(filePath?: string): "ts" | "py" | "verilog" | "other" {
  if (!filePath) return "other";
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".js") || lower.endsWith(".tsx") || lower.endsWith(".jsx")) return "ts";
  if (lower.endsWith(".py")) return "py";
  if (lower.endsWith(".v") || lower.endsWith(".sv")) return "verilog";
  return "other";
}

function cliHighlightSafe(content: string, lang: ReturnType<typeof getLanguage>): string {
  if (lang === "other") {
    try {
      return cliHighlight(content, { ignoreIllegals: true });
    } catch {
      return content;
    }
  }

  try {
    return cliHighlight(content, {
      language: lang === "verilog" ? "verilog" : lang,
      ignoreIllegals: true,
    });
  } catch {
    return content;
  }
}

function highlightLine(line: string, lang: ReturnType<typeof getLanguage>): string {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return chalk.bold(line);
  }
  if (line.startsWith("@@")) {
    return chalk.cyan(line);
  }

  const first = line[0];
  if (first === "+" || first === "-") {
    const rest = line.slice(1);
    const highlighted = cliHighlightSafe(rest, lang);
    return first === "+" ? chalk.green("+" + highlighted) : chalk.red("-" + highlighted);
  }

  return chalk.gray(line);
}

export function highlightDiff(patch: string, filePath?: string): string {
  const lang = getLanguage(filePath);
  const lines = patch.split(/\r?\n/);
  const out = lines.map((l) => highlightLine(l, lang)).join("\n");
  return out;
}

export function highlightFileContent(content: string, filePath?: string): string {
  const lang = getLanguage(filePath);
  return cliHighlightSafe(content, lang);
}
