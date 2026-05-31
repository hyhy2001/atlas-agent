import { useState, useCallback } from "react";
import type { PermissionKind } from "../components/PermissionRequest.js";

export interface PendingPermission {
  id: string;
  kind: PermissionKind;
  toolName: string;
  description: string;
  detail?: string;
  risk?: "low" | "medium" | "high";
  resolve: (allowed: boolean, always?: boolean) => void;
}

let _id = 0;

export interface UsePermissionQueueResult {
  pending: PendingPermission | null;
  request: (req: Omit<PendingPermission, "id" | "resolve">) => Promise<{ allowed: boolean; always: boolean }>;
  allow: () => void;
  deny: () => void;
  allowAlways: () => void;
}

export function usePermissionQueue(): UsePermissionQueueResult {
  const [queue, setQueue] = useState<PendingPermission[]>([]);
  const pending = queue[0] ?? null;

  const request = useCallback((req: Omit<PendingPermission, "id" | "resolve">) => {
    return new Promise<{ allowed: boolean; always: boolean }>((resolve) => {
      const id = String(++_id);
      setQueue(q => [...q, { ...req, id, resolve: (allowed, always = false) => resolve({ allowed, always }) }]);
    });
  }, []);

  const pop = useCallback(() => {
    setQueue(q => q.slice(1));
  }, []);

  const allow = useCallback(() => {
    pending?.resolve(true, false);
    pop();
  }, [pending, pop]);

  const deny = useCallback(() => {
    pending?.resolve(false, false);
    pop();
  }, [pending, pop]);

  const allowAlways = useCallback(() => {
    pending?.resolve(true, true);
    pop();
  }, [pending, pop]);

  return { pending, request, allow, deny, allowAlways };
}
