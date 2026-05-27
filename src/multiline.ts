export interface MultilineResult {
  text: string;
  isMultiline: boolean;
}

export function isMultilineStart(line: string): boolean {
  return line.trim() === "```";
}

export function isMultilineEnd(line: string): boolean {
  return line.trim() === "```";
}

export function shouldContinue(line: string): boolean {
  return line.endsWith("\\");
}

export function stripContinuation(line: string): string {
  if (shouldContinue(line)) {
    return line.slice(0, -1);
  }
  return line;
}
