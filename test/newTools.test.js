import { describe, it, expect } from "vitest";
import { globTool } from "../src/tools/builtin/glob.js";
import { todoReadTool, todoWriteTool } from "../src/tools/builtin/todo.js";
import { webFetchTool } from "../src/tools/builtin/web_fetch.js";

const ctx = {
  workingDir: process.cwd(),
  abortSignal: new AbortController().signal,
  permissions: { check: () => true, grant: () => {} },
};

describe("glob tool", () => {
  it("finds TypeScript files", async () => {
    const result = await globTool.execute({ pattern: "*.ts", path: "src" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.content).toContain("cli.ts");
  });

  it("returns message when no files match", async () => {
    const result = await globTool.execute({ pattern: "*.nonexistent" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.content).toContain("No files found");
  });
});

describe("todo tools", () => {
  it("read returns empty initially", async () => {
    const result = await todoReadTool.execute({}, { ...ctx, workingDir: "/tmp/test-todo" });
    expect(result.content).toContain("empty");
  });

  it("write + read round-trip", async () => {
    const testCtx = { ...ctx, workingDir: "/tmp/test-todo-2" };
    await todoWriteTool.execute({
      todos: [{ id: "1", content: "Test task", status: "pending", priority: "high" }],
    }, testCtx);
    const result = await todoReadTool.execute({}, testCtx);
    expect(result.content).toContain("Test task");
    expect(result.content).toContain("HIGH");
  });
});

describe("web_fetch tool", () => {
  it("handles invalid URL gracefully", async () => {
    const result = await webFetchTool.execute({ url: "http://localhost:1" }, ctx);
    expect(result.isError).toBe(true);
  });
});
