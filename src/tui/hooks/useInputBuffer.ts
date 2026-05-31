import { useRef, useCallback } from "react";

interface BufferEntry {
  text: string;
  cursorOffset: number;
  timestamp: number;
}

interface UseInputBufferResult {
  pushToBuffer: (text: string, cursorOffset: number) => void;
  undo: () => BufferEntry | null;
  canUndo: boolean;
  clearBuffer: () => void;
}

const MAX_BUFFER_SIZE = 50;
const DEBOUNCE_MS = 1000;

export function useInputBuffer(): UseInputBufferResult {
  const bufferRef = useRef<BufferEntry[]>([]);
  const currentIndexRef = useRef<number>(-1);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushToBuffer = useCallback((text: string, cursorOffset: number) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      const buffer = bufferRef.current;
      const last = buffer[currentIndexRef.current];
      if (last && last.text === text) return;
      bufferRef.current = buffer.slice(0, currentIndexRef.current + 1);
      bufferRef.current.push({ text, cursorOffset, timestamp: Date.now() });
      if (bufferRef.current.length > MAX_BUFFER_SIZE) {
        bufferRef.current = bufferRef.current.slice(-MAX_BUFFER_SIZE);
      }
      currentIndexRef.current = bufferRef.current.length - 1;
    }, DEBOUNCE_MS);
  }, []);

  const undo = useCallback((): BufferEntry | null => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (currentIndexRef.current <= 0) return null;
    currentIndexRef.current--;
    return bufferRef.current[currentIndexRef.current] ?? null;
  }, []);

  const canUndo = currentIndexRef.current > 0;

  const clearBuffer = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    bufferRef.current = [];
    currentIndexRef.current = -1;
  }, []);

  return { pushToBuffer, undo, canUndo, clearBuffer };
}
