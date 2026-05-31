import { useRef, useState, useCallback } from "react";
import type { Key } from "ink";
import type { VimState, Operator, FindType } from "./types.js";
import { INITIAL_VIM_STATE, MAX_VIM_COUNT } from "./types.js";
import {
  moveLeft,
  moveRight,
  moveWordForward,
  moveWordBackward,
  moveWordEnd,
  moveLineStart,
  moveLineEnd,
  moveFirstNonBlank,
} from "./motions.js";

export interface VimInputResult {
  text: string;
  offset: number;
  consumed: boolean;
}

export interface UseVimResult {
  vimState: VimState;
  handleVimInput: (
    input: string,
    key: Key,
    text: string,
    offset: number,
  ) => VimInputResult;
  resetToInsert: () => void;
}

export function useVim(): UseVimResult {
  const stateRef = useRef<VimState>({ ...INITIAL_VIM_STATE });
  const [vimMode, setVimMode] = useState<"INSERT" | "NORMAL">("INSERT");

  const setState = (next: Partial<VimState>) => {
    stateRef.current = { ...stateRef.current, ...next };
    if (next.mode !== undefined) setVimMode(next.mode);
  };

  const handleVimInput = useCallback((
    input: string,
    key: Key,
    text: string,
    offset: number,
  ): VimInputResult => {
    const state = stateRef.current;

    if (key.ctrl) return { text, offset, consumed: false };

    if (state.mode === "INSERT") {
      if (key.escape) {
        setState({ mode: "NORMAL", command: { type: "idle" }, insertedText: "" });
        return { text, offset: Math.max(0, offset - 1), consumed: true };
      }
      setState({ insertedText: state.insertedText + input });
      return { text, offset, consumed: false };
    }

    const cmd = state.command;

    if (input === "i") {
      setState({ mode: "INSERT", command: { type: "idle" }, insertedText: "" });
      setVimMode("INSERT");
      return { text, offset, consumed: true };
    }
    if (input === "I") {
      setState({ mode: "INSERT", command: { type: "idle" }, insertedText: "" });
      setVimMode("INSERT");
      return { text, offset: moveFirstNonBlank(text, offset), consumed: true };
    }
    if (input === "a") {
      setState({ mode: "INSERT", command: { type: "idle" }, insertedText: "" });
      setVimMode("INSERT");
      return { text, offset: Math.min(text.length, offset + 1), consumed: true };
    }
    if (input === "A") {
      setState({ mode: "INSERT", command: { type: "idle" }, insertedText: "" });
      setVimMode("INSERT");
      return { text, offset: moveLineEnd(text, offset), consumed: true };
    }
    if (input === "o") {
      const lineEnd = moveLineEnd(text, offset);
      const newText = text.slice(0, lineEnd) + "\n" + text.slice(lineEnd);
      setState({ mode: "INSERT", command: { type: "idle" }, insertedText: "" });
      setVimMode("INSERT");
      return { text: newText, offset: lineEnd + 1, consumed: true };
    }

    if (/^[1-9]$/.test(input) && cmd.type === "idle") {
      setState({ command: { type: "count", digits: input } });
      return { text, offset, consumed: true };
    }
    if (/^[0-9]$/.test(input) && cmd.type === "count") {
      const digits = cmd.digits + input;
      if (parseInt(digits) > MAX_VIM_COUNT) return { text, offset, consumed: true };
      setState({ command: { type: "count", digits } });
      return { text, offset, consumed: true };
    }

    const count = cmd.type === "count" ? parseInt(cmd.digits) : 1;

    const motionMap: Record<string, (t: string, o: number) => number> = {
      "h": (t, o) => moveLeft(t, o, count),
      "l": (t, o) => moveRight(t, o, count),
      "w": (t, o) => moveWordForward(t, o, count),
      "b": (t, o) => moveWordBackward(t, o, count),
      "e": (t, o) => moveWordEnd(t, o, count),
      "0": (t, o) => moveLineStart(t, o),
      "^": (t, o) => moveFirstNonBlank(t, o),
      "$": (t, o) => moveLineEnd(t, o),
    };

    if (motionMap[input] && (cmd.type === "idle" || cmd.type === "count")) {
      const newOffset = motionMap[input]!(text, offset);
      setState({ command: { type: "idle" } });
      return { text, offset: newOffset, consumed: true };
    }

    if (input === "x" && (cmd.type === "idle" || cmd.type === "count")) {
      const end = Math.min(text.length, offset + count);
      const deleted = text.slice(offset, end);
      setState({ register: deleted, command: { type: "idle" } });
      return { text: text.slice(0, offset) + text.slice(end), offset, consumed: true };
    }

    if (input === "d" && (cmd.type === "idle" || cmd.type === "count")) {
      setState({ command: { type: "operator", op: "delete", count } });
      return { text, offset, consumed: true };
    }
    if (input === "d" && cmd.type === "operator" && cmd.op === "delete") {
      const lineStart = moveLineStart(text, offset);
      const lineEnd = moveLineEnd(text, offset);
      const deleted = text.slice(lineStart, lineEnd + 1);
      const newText = text.slice(0, lineStart) + text.slice(lineEnd + 1);
      setState({ register: deleted, registerIsLinewise: true, command: { type: "idle" } });
      return { text: newText, offset: Math.min(lineStart, newText.length), consumed: true };
    }

    if (input === "p" && cmd.type === "idle") {
      const newText = text.slice(0, offset + 1) + state.register + text.slice(offset + 1);
      setState({ command: { type: "idle" } });
      return { text: newText, offset: offset + 1, consumed: true };
    }

    if (input === "u" && cmd.type === "idle") {
      setState({ command: { type: "idle" } });
      return { text, offset, consumed: false };
    }

    if (key.escape) {
      setState({ command: { type: "idle" } });
      return { text, offset, consumed: true };
    }

    setState({ command: { type: "idle" } });
    return { text, offset, consumed: true };
  }, []);

  const resetToInsert = useCallback(() => {
    setState({ ...INITIAL_VIM_STATE });
    setVimMode("INSERT");
  }, []);

  return {
    vimState: { ...stateRef.current, mode: vimMode },
    handleVimInput,
    resetToInsert,
  };
}
