interface UndoEntry {
  path: string;
  previousContent: string | null;
  timestamp: number;
}

const undoStack: UndoEntry[] = [];

export function pushUndo(entry: UndoEntry): void {
  undoStack.push(entry);
  if (undoStack.length > 50) undoStack.shift();
}

export function popUndo(): UndoEntry | undefined {
  return undoStack.pop();
}

export function undoStackSize(): number {
  return undoStack.length;
}
