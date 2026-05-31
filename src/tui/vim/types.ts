export type VimMode = "INSERT" | "NORMAL";

export type Operator = "delete" | "change" | "yank";
export type FindType = "f" | "F" | "t" | "T";
export type TextObjScope = "inner" | "around";

export type CommandState =
  | { type: "idle" }
  | { type: "count"; digits: string }
  | { type: "operator"; op: Operator; count: number }
  | { type: "operatorCount"; op: Operator; count: number; digits: string }
  | { type: "find"; find: FindType; count: number }
  | { type: "replace"; count: number };

export interface VimState {
  mode: VimMode;
  command: CommandState;
  insertedText: string;
  register: string;
  registerIsLinewise: boolean;
  lastFind: { type: FindType; char: string } | null;
}

export const INITIAL_VIM_STATE: VimState = {
  mode: "INSERT",
  command: { type: "idle" },
  insertedText: "",
  register: "",
  registerIsLinewise: false,
  lastFind: null,
};

export const MAX_VIM_COUNT = 1000;
