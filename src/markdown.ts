import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import { highlight } from "cli-highlight";
import chalk from "chalk";

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

  write(chunk: string): string {
    this.buffer += chunk;
    let output = "";

    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
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
        output += chalk.cyan(line) + "\n";
        continue;
      }

      output += this.renderLine(line) + "\n";
    }

    return output;
  }

  flush(): string {
    if (!this.buffer) return "";
    const output = this.inCodeBlock ? chalk.cyan(this.buffer) : this.renderLine(this.buffer);
    this.buffer = "";
    return output;
  }

  private renderLine(line: string): string {
    if (line.startsWith("### ")) return chalk.bold(line);
    if (line.startsWith("## ")) return chalk.bold(line);
    if (line.startsWith("# ")) return chalk.bold(line);

    if (line.match(/^[-*_]{3,}$/)) return chalk.gray("─".repeat(40));

    if (line.startsWith("> ")) return chalk.gray("│ ") + chalk.italic(line.slice(2));

    let text = line;
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, (_, t) => chalk.bold.italic(t));
    text = text.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t));
    text = text.replace(/\*(.+?)\*/g, (_, t) => chalk.italic(t));
    text = text.replace(/`([^`]+)`/g, (_, t) => chalk.bgGray.white(` ${t} `));
    text = text.replace(/~~(.+?)~~/g, (_, t) => chalk.strikethrough(t));
    return text;
  }
}
