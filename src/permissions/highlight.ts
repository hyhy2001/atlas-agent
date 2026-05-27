import chalk from "chalk";
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

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightTokens(text: string, lang: string): string {
  // Protect strings and comments by placeholders
  const strings: string[] = [];
  const comments: string[] = [];

  // string regex: single, double, backtick (JS/TS)
  const stringRe = /(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
  text = text.replace(stringRe, (m) => {
    strings.push(m);
    return `__STR_${strings.length - 1}__`;
  });

  // comments depending on language
  if (lang === "py") {
    const commentRe = /(#.*)/g;
    text = text.replace(commentRe, (m) => {
      comments.push(m);
      return `__CMT_${comments.length - 1}__`;
    });
  } else if (lang === "ts" || lang === "verilog") {
    const commentRe = /(\/\/.*)/g;
    text = text.replace(commentRe, (m) => {
      comments.push(m);
      return `__CMT_${comments.length - 1}__`;
    });
  }

  // numbers: simple regex (including verilog like 4'b1010 or 8'hFF)
  const numberRe = /\b(0b[01_]+|0x[0-9a-fA-F_]+|\d[\d_]*(?:\.[\d_]+)?)\b/g;
  text = text.replace(numberRe, (m) => {
    return chalk.magenta(m);
  });

  // keywords
  const kwTs = [
    "const",
    "let",
    "var",
    "function",
    "return",
    "if",
    "else",
    "import",
    "export",
    "class",
    "interface",
    "type",
    "async",
    "await",
  ];
  const kwPy = [
    "def",
    "class",
    "return",
    "if",
    "else",
    "import",
    "from",
    "async",
    "await",
    "with",
    "for",
    "in",
    "not",
    "and",
    "or",
  ];
  const kwVerilog = [
    "module",
    "endmodule",
    "input",
    "output",
    "wire",
    "reg",
    "always",
    "assign",
    "begin",
    "end",
    "if",
    "else",
    "case",
    "endcase",
    "posedge",
    "negedge",
  ];

  let kws: string[] = [];
  if (lang === "ts") kws = kwTs;
  else if (lang === "py") kws = kwPy;
  else if (lang === "verilog") kws = kwVerilog;

  if (kws.length > 0) {
    const pattern = `\\b(${kws.map(escapeRegex).join("|")})\\b`;
    const re = new RegExp(pattern, "g");
    text = text.replace(re, (m) => chalk.blue(m));
  }

  // restore comments
  for (let i = 0; i < comments.length; i++) {
    const token = `__CMT_${i}__`;
    text = text.replace(token, chalk.gray(comments[i]));
  }

  // restore strings
  for (let i = 0; i < strings.length; i++) {
    const token = `__STR_${i}__`;
    text = text.replace(token, chalk.yellow(strings[i]));
  }

  return text;
}

function highlightLine(line: string, lang: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return chalk.bold(line);
  }
  if (line.startsWith("@@")) {
    return chalk.cyan(line);
  }
  const first = line[0];
  if (first === "+" || first === "-") {
    const rest = line.slice(1);
    if (lang === "other") {
      return first === "+" ? chalk.green(line) : chalk.red(line);
    }
    const highlighted = highlightTokens(rest, lang);
    return first === "+" ? chalk.green("+" + highlighted) : chalk.red("-" + highlighted);
  }
  // default: no token highlighting
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
  const lines = content.split(/\r?\n/);
  if (lang === "other") {
    return lines.map((l) => chalk.gray(l)).join("\n");
  }
  return lines.map((l) => highlightTokens(l, lang)).join("\n");
}
