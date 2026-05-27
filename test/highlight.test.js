import { describe, it, expect } from "vitest";
import { highlightDiff, getLanguage } from "../src/permissions/highlight.ts";

describe("getLanguage", () => {
  it("identifies TypeScript/JavaScript files", () => {
    expect(getLanguage("src/foo.ts")).toBe("ts");
    expect(getLanguage("bar.js")).toBe("ts");
    expect(getLanguage("comp.tsx")).toBe("ts");
    expect(getLanguage("comp.jsx")).toBe("ts");
  });

  it("identifies Python files", () => {
    expect(getLanguage("script.py")).toBe("py");
    expect(getLanguage("DIR/UPPER.PY")).toBe("py");
  });

  it("identifies Verilog/SystemVerilog files", () => {
    expect(getLanguage("chip.v")).toBe("verilog");
    expect(getLanguage("design.sv")).toBe("verilog");
    expect(getLanguage("PATH/MOD.SV")).toBe("verilog");
  });

  it("returns other for unknown extensions", () => {
    expect(getLanguage("readme.md")).toBe("other");
    expect(getLanguage("data.json")).toBe("other");
    expect(getLanguage(undefined)).toBe("other");
  });
});

describe("highlightDiff", () => {
  const patch = [
    "--- old",
    "+++ new",
    "@@ -1,3 +1,3 @@",
    " unchanged",
    "-const x = 1;",
    "+const x = 2;",
    " end",
  ].join("\n");

  it("returns ANSI codes for + lines", () => {
    const result = highlightDiff(patch, "file.ts");
    // green escape for + lines: \x1b[32m
    expect(result).toContain("\x1b[32m");
  });

  it("returns ANSI codes for - lines", () => {
    const result = highlightDiff(patch, "file.ts");
    // red escape for - lines: \x1b[31m
    expect(result).toContain("\x1b[31m");
  });

  it("returns cyan for hunk headers", () => {
    const result = highlightDiff(patch, "file.ts");
    // cyan escape: \x1b[36m
    expect(result).toContain("\x1b[36m");
  });

  it("returns bold for --- and +++ lines", () => {
    const result = highlightDiff(patch, "file.ts");
    // bold escape: \x1b[1m
    expect(result).toContain("\x1b[1m");
  });

  it("applies token highlighting for known languages", () => {
    const result = highlightDiff(patch, "file.ts");
    // blue escape for keyword 'const': \x1b[34m
    expect(result).toContain("\x1b[34m");
  });

  it("works without token highlighting for unknown extensions", () => {
    const result = highlightDiff(patch, "file.txt");
    // should still have green/red for +/- lines
    expect(result).toContain("\x1b[32m");
    expect(result).toContain("\x1b[31m");
  });
});
