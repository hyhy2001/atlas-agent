import type { ChildProcess } from "node:child_process";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class JsonRpcConnection {
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private notificationHandlers = new Map<string, (params: unknown) => void>();
  private buffer = Buffer.alloc(0);
  private closed = false;

  constructor(private proc: ChildProcess) {
    proc.stdout!.on("data", (chunk: Buffer) => this.handleChunk(chunk));
    proc.stderr!.on("data", () => {});
    proc.on("exit", () => { this.closed = true; this.rejectAllPending(new Error("Server exited")); });
    proc.on("error", (err) => { this.closed = true; this.rejectAllPending(err); });
  }

  private handleChunk(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer as Uint8Array, chunk as Uint8Array]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) { this.buffer = this.buffer.slice(headerEnd + 4); continue; }
      const len = parseInt(match[1], 10);
      const total = headerEnd + 4 + len;
      if (this.buffer.length < total) return;
      const body = this.buffer.slice(headerEnd + 4, total).toString("utf8");
      this.buffer = this.buffer.slice(total);
      this.dispatch(body);
    }
  }

  private dispatch(body: string): void {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(body) as Record<string, unknown>; } catch { return; }
    if (msg["id"] !== undefined && (msg["result"] !== undefined || msg["error"] !== undefined)) {
      const id = msg["id"] as number;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (msg["error"]) {
        const e = msg["error"] as Record<string, unknown>;
        pending.reject(new Error((e["message"] as string) ?? "LSP error"));
      } else {
        pending.resolve(msg["result"]);
      }
    } else if (msg["method"]) {
      const handler = this.notificationHandlers.get(msg["method"] as string);
      if (handler) handler(msg["params"]);
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }

  private send(obj: object): void {
    if (this.closed) throw new Error("Connection closed");
    const json = JSON.stringify(obj);
    const buf = Buffer.from(json, "utf8");
    this.proc.stdin!.write(`Content-Length: ${buf.length}\r\n\r\n`);
    this.proc.stdin!.write(buf);
  }

  sendRequest<T = unknown>(method: string, params?: unknown, timeoutMs = 10000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      try { this.send({ jsonrpc: "2.0", id, method, params }); }
      catch (err) { clearTimeout(timer); this.pending.delete(id); reject(err as Error); }
    });
  }

  sendNotification(method: string, params?: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    this.notificationHandlers.set(method, handler);
  }

  close(): void {
    this.closed = true;
    try { this.proc.kill(); } catch {}
    this.rejectAllPending(new Error("Connection closed"));
  }

  isClosed(): boolean { return this.closed; }
}
