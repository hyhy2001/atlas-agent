import chalk from "chalk";

export class MarkdownRenderer {
  private buffer = "";
  private inCodeBlock = false;
  private codeBlockLang = "";

  write(chunk: string): string {
    this.buffer += chunk;
    let output = "";

    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      output += this.renderLine(line) + "\n";
    }

    return output;
  }

  flush(): string {
    if (!this.buffer) return "";
    const output = this.renderLine(this.buffer);
    this.buffer = "";
    return output;
  }

  private renderLine(line: string): string {
    if (line.startsWith("```")) {
      if (this.inCodeBlock) {
        this.inCodeBlock = false;
        this.codeBlockLang = "";
        return chalk.gray("```");
      }

      this.inCodeBlock = true;
      this.codeBlockLang = line.slice(3).trim();
      return chalk.gray(line);
    }

    if (this.inCodeBlock) {
      return chalk.cyan(line);
    }

    if (line.startsWith("### ")) return chalk.bold.blue(line);
    if (line.startsWith("## ")) return chalk.bold.blue(line);
    if (line.startsWith("# ")) return chalk.bold.blue(line);

    if (line.match(/^[-*_]{3,}$/)) return chalk.gray("─".repeat(40));

    if (line.startsWith("> ")) {
      return chalk.gray("│ ") + chalk.italic(line.slice(2));
    }

    if (line.match(/^(\s*)([-*+]|\d+\.) /)) {
      return this.renderInline(line);
    }

    return this.renderInline(line);
  }

  private renderInline(text: string): string {
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, (_, t) => chalk.bold.italic(t));
    text = text.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t));
    text = text.replace(/\*(.+?)\*/g, (_, t) => chalk.italic(t));
    text = text.replace(/_(.+?)_/g, (_, t) => chalk.italic(t));
    text = text.replace(/`([^`]+)`/g, (_, t) => chalk.bgGray.white(` ${t} `));
    text = text.replace(/~~(.+?)~~/g, (_, t) => chalk.strikethrough(t));
    return text;
  }
}
