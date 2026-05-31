import { useState, useCallback, useRef } from "react";
import type { OverlayItem } from "../types.js";

export type DialogKind =
  | "tool-permission"
  | "sandbox-permission"
  | "prompt"
  | "callout";

export interface DialogRequest {
  id: string;
  kind: DialogKind;
  question: string;
  items: OverlayItem[];
  selectedIndex: number;
  resolve: (answer: string) => void;
}

const KIND_PRIORITY: Record<DialogKind, number> = {
  "tool-permission": 0,
  "sandbox-permission": 1,
  "prompt": 2,
  "callout": 3,
};

export type DialogEnqueueInput = Omit<DialogRequest, "id" | "resolve">;

export interface UseDialogQueueResult {
  focused: DialogRequest | null;
  enqueue: (req: DialogEnqueueInput) => Promise<string>;
  dismiss: () => void;
  answer: (value: string) => void;
  setSelectedIndex: (idx: number) => void;
}

let _idCounter = 0;

export function useDialogQueue(): UseDialogQueueResult {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const queueRef = useRef<DialogRequest[]>([]);

  const sorted = [...queue].sort(
    (a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]
  );
  const focused = sorted[0] ?? null;

  const enqueue = useCallback((req: DialogEnqueueInput): Promise<string> => {
    return new Promise<string>((resolve) => {
      const id = String(++_idCounter);
      const entry: DialogRequest = { ...req, id, resolve };
      setQueue(q => {
        const next = [...q, entry];
        queueRef.current = next;
        return next;
      });
    });
  }, []);

  const removeHead = useCallback((id: string) => {
    setQueue(q => {
      const next = q.filter(d => d.id !== id);
      queueRef.current = next;
      return next;
    });
  }, []);

  const answer = useCallback((value: string) => {
    if (!focused) return;
    focused.resolve(value);
    removeHead(focused.id);
  }, [focused, removeHead]);

  const dismiss = useCallback(() => {
    if (!focused) return;
    focused.resolve("");
    removeHead(focused.id);
  }, [focused, removeHead]);

  const setSelectedIndex = useCallback((idx: number) => {
    setQueue(q => q.map(d =>
      d.id === focused?.id ? { ...d, selectedIndex: idx } : d
    ));
  }, [focused]);

  return { focused, enqueue, dismiss, answer, setSelectedIndex };
}
