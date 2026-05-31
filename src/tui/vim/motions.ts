import type { FindType } from "./types.js";

export function moveLeft(text: string, offset: number, count = 1): number {
  return Math.max(0, offset - count);
}

export function moveRight(text: string, offset: number, count = 1): number {
  return Math.min(text.length, offset + count);
}

export function moveWordForward(text: string, offset: number, count = 1): number {
  let pos = offset;
  for (let i = 0; i < count; i++) {
    while (pos < text.length && /\w/.test(text[pos]!)) pos++;
    while (pos < text.length && /\s/.test(text[pos]!)) pos++;
  }
  return pos;
}

export function moveWordBackward(text: string, offset: number, count = 1): number {
  let pos = offset;
  for (let i = 0; i < count; i++) {
    pos = Math.max(0, pos - 1);
    while (pos > 0 && /\s/.test(text[pos]!)) pos--;
    while (pos > 0 && /\w/.test(text[pos - 1]!)) pos--;
  }
  return pos;
}

export function moveWordEnd(text: string, offset: number, count = 1): number {
  let pos = offset;
  for (let i = 0; i < count; i++) {
    pos++;
    while (pos < text.length && /\s/.test(text[pos]!)) pos++;
    while (pos < text.length - 1 && /\w/.test(text[pos + 1]!)) pos++;
  }
  return Math.min(text.length - 1, pos);
}

export function moveLineStart(text: string, offset: number): number {
  const lineStart = text.lastIndexOf("\n", offset - 1);
  return lineStart === -1 ? 0 : lineStart + 1;
}

export function moveLineEnd(text: string, offset: number): number {
  const lineEnd = text.indexOf("\n", offset);
  return lineEnd === -1 ? text.length : lineEnd;
}

export function moveFirstNonBlank(text: string, offset: number): number {
  const start = moveLineStart(text, offset);
  let pos = start;
  while (pos < text.length && text[pos] === " ") pos++;
  return pos;
}

export function findChar(
  text: string,
  offset: number,
  char: string,
  type: FindType,
  count = 1,
): number {
  let pos = offset;
  for (let i = 0; i < count; i++) {
    if (type === "f" || type === "t") {
      const next = text.indexOf(char, pos + 1);
      if (next === -1) break;
      pos = type === "t" ? next - 1 : next;
    } else {
      const prev = text.lastIndexOf(char, pos - 1);
      if (prev === -1) break;
      pos = type === "T" ? prev + 1 : prev;
    }
  }
  return pos;
}
