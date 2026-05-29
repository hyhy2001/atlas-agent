import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import { highlight } from "cli-highlight";
import chalk from "chalk";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

marked.setOptions({
  renderer: new TerminalRenderer({
    code: (code: string, lang?: string) => {
      try {
        if (lang) {
          return highlight(code, { language: lang, ignoreIllegals: true });
        }
        return highlight(code, { ignoreIllegals: true });
      } catch {
        return chalk.cyan(code);
      }
    },
    codespan: (text: string) => chalk.bgGray.white(` ${text} `),
    heading: (text: string, level: number) => {
      const prefix = "#".repeat(level);
      return chalk.bold(`${prefix} ${text}`) + "\n";
    },
    blockquote: (text: string) => chalk.gray("│ ") + chalk.italic(text),
    hr: () => chalk.gray("─".repeat(40)) + "\n",
    list: (body: string) => body,
    listitem: (text: string) => `  ${chalk.gray("•")} ${text}\n`,
    strong: (text: string) => chalk.bold(text),
    em: (text: string) => chalk.italic(text),
    del: (text: string) => chalk.strikethrough(text),
    link: (href: string, _title: string, text: string) => `${text} ${chalk.gray(`(${href})`)}`,
    paragraph: (text: string) => text + "\n",
  }) as any,
});

export class MarkdownRenderer {
  private buffer = "";
  private inCodeBlock = false;
  private codeBlockLines: string[] = [];
  private codeBlockLang = "";
  private tableBuffer: string[] = [];
  private inTable = false;

  write(chunk: string): string {
    this.buffer += chunk;
    let output = "";

    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const tableRow = this.parseTableRow(line);
      if (tableRow !== null) {
        if (!this.inTable) {
          this.inTable = true;
          this.tableBuffer = [];
        }
        if (!this.isDelimiterRow(tableRow)) {
          this.tableBuffer.push(line);
        }
        continue;
      } else if (this.inTable) {
        if (line.trim() === "") continue;
        const rows = this.tableBuffer.map(l => this.parseTableRow(l)!);
        output += this.renderTable(rows);
        this.tableBuffer = [];
        this.inTable = false;
      }

      if (line.startsWith("```")) {
        if (this.inCodeBlock) {
          const code = this.codeBlockLines.join("\n");
          try {
            if (this.codeBlockLang) {
              output += highlight(code, { language: this.codeBlockLang, ignoreIllegals: true }) + "\n";
            } else {
              output += highlight(code, { ignoreIllegals: true }) + "\n";
            }
          } catch {
            output += chalk.cyan(code) + "\n";
          }
          output += chalk.gray("```") + "\n";
          this.inCodeBlock = false;
          this.codeBlockLines = [];
          this.codeBlockLang = "";
        } else {
          this.inCodeBlock = true;
          this.codeBlockLang = line.slice(3).trim();
          output += chalk.gray(line) + "\n";
        }
        continue;
      }

      if (this.inCodeBlock) {
        this.codeBlockLines.push(line);
        continue;
      }

      output += this.renderLine(line) + "\n";
    }

    return output;
  }

  flush(): string {
    let output = "";
    const bufferedTableRow = this.parseTableRow(this.buffer);
    if (bufferedTableRow !== null) {
      if (!this.inTable) {
        this.inTable = true;
        this.tableBuffer = [];
      }
      if (!this.isDelimiterRow(bufferedTableRow)) {
        this.tableBuffer.push(this.buffer);
      }
      this.buffer = "";
    }
    if (this.inTable && this.tableBuffer.length > 0) {
      const rows = this.tableBuffer.map(l => this.parseTableRow(l)!);
      output += this.renderTable(rows);
      this.tableBuffer = [];
      this.inTable = false;
    }
    // If stream ended inside an unclosed code block, emit accumulated lines
    if (this.inCodeBlock && this.codeBlockLines.length > 0) {
      const code = this.codeBlockLines.join("\n");
      try {
        output += this.codeBlockLang
          ? highlight(code, { language: this.codeBlockLang, ignoreIllegals: true }) + "\n"
          : highlight(code, { ignoreIllegals: true }) + "\n";
      } catch {
        output += chalk.cyan(code) + "\n";
      }
      this.codeBlockLines = [];
    }
    if (this.buffer) {
      output += this.inCodeBlock ? chalk.cyan(this.buffer) : this.renderLine(this.buffer);
      this.buffer = "";
    }
    return output;
  }

  private renderTable(rows: string[][]): string {
    if (rows.length === 0) return "";

    const colCount = Math.max(...rows.map(r => r.length));
    const colWidths: number[] = Array(colCount).fill(0);
    for (const row of rows) {
      for (let i = 0; i < row.length; i++) {
        colWidths[i] = Math.max(colWidths[i], stripAnsi(row[i]).length);
      }
    }

    const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - stripAnsi(s).length));
    const top = "┌" + colWidths.map(w => "─".repeat(w + 2)).join("┬") + "┐";
    const mid = "├" + colWidths.map(w => "─".repeat(w + 2)).join("┼") + "┤";
    const bot = "└" + colWidths.map(w => "─".repeat(w + 2)).join("┴") + "┘";
    const row2str = (row: string[], bold = false) =>
      "│" + row.map((cell, i) => " " + (bold ? chalk.bold(pad(cell, colWidths[i])) : pad(cell, colWidths[i])) + " ").join("│") + "│";

    const lines: string[] = [];
    lines.push(chalk.gray(top));
    rows.forEach((row, i) => {
      if (i === 0) {
        lines.push(row2str(row, true));
        lines.push(chalk.gray(mid));
      } else {
        lines.push(row2str(row, false));
      }
    });
    lines.push(chalk.gray(bot));
    return lines.join("\n") + "\n";
  }

  private parseTableRow(line: string): string[] | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
    return trimmed.slice(1, -1).split("|").map(cell => cell.trim());
  }

  private isDelimiterRow(cells: string[]): boolean {
    return cells.every(cell => /^:?-+:?$/.test(cell.trim()));
  }

  private renderLine(line: string): string {
    if (line.startsWith("### ")) return chalk.bold(line);
    if (line.startsWith("## ")) return chalk.bold(line);
    if (line.startsWith("# ")) return chalk.bold(line);

    if (line.match(/^[-*_]{3,}$/)) return chalk.gray("─".repeat(40));

    if (line.startsWith("> ")) return chalk.gray("│ ") + chalk.italic(line.slice(2));

    // Unordered list item: -, *, + (with optional leading whitespace for nesting)
    const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
    if (ulMatch) {
      const [, indent, , content] = ulMatch;
      const depth = Math.floor(indent.length / 2);
      const bullet = depth === 0 ? "•" : depth === 1 ? "◦" : "▪";
      return indent + chalk.gray(bullet) + " " + this.renderInline(content);
    }

    // Ordered list item: "1. " or "1) "
    const olMatch = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (olMatch) {
      const [, indent, num, content] = olMatch;
      return indent + chalk.gray(num + ".") + " " + this.renderInline(content);
    }

    return this.renderInline(line);
  }

  private renderInline(line: string): string {
    let text = line;
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, (_, t) => chalk.bold.italic(t));
    text = text.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t));
    text = text.replace(/\*(.+?)\*/g, (_, t) => chalk.italic(t));
    text = text.replace(/`([^`]+)`/g, (_, t) => chalk.bgGray.white(` ${t} `));
    text = text.replace(/~~(.+?)~~/g, (_, t) => chalk.strikethrough(t));
    return text;
  }
}
