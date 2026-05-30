import React from "react";
import { render } from "ink";
import { PassThrough } from "node:stream";
import chalk from "chalk";
import { App } from "./App.js";
import type { OpenAIProvider } from "../provider/openai.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolExecutor } from "../tools/executor.js";
import type { Session } from "../sessions.js";
import type { CustomCommand } from "../commands.js";
import type { SubagentProfile } from "../agent/subagents.js";
import type { HooksConfig } from "../hooks.js";
import type { Skill } from "../skills.js";

// IME compose support (Vietnamese Telex, CJK, etc.):
// IBus / fcitx erase the preedit base character by sending DEL (0x7f)
// immediately before the composed character — sometimes in the same chunk
// as the composed bytes. Ink's stock tokenizer treats the whole chunk as
// one inputChar and forwards "\x7fã"; the embedded DEL never reaches the
// backspace handler, so the base char stays in the buffer ("Bây" → "Baây").
//
// Mirror the cc-ref approach: split each chunk so embedded DEL bytes are
// emitted as their own events. Ink then parses each DEL into key.backspace
// independently of the composed character that follows.
function createImeAwareStdin(real: NodeJS.ReadStream): NodeJS.ReadStream {
  const proxy: PassThrough & {
    isTTY?: boolean;
    setRawMode?: NodeJS.ReadStream["setRawMode"];
    isRaw?: boolean;
    ref?: () => void;
    unref?: () => void;
  } = new PassThrough();

  proxy.isTTY = real.isTTY;
  proxy.setRawMode = (mode: boolean) => {
    real.setRawMode?.(mode);
    return real as unknown as NodeJS.ReadStream;
  };
  proxy.ref = () => real.ref();
  proxy.unref = () => real.unref();

  real.on("data", (chunk: Buffer | string) => {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x7f) {
        if (i > start) proxy.write(buf.slice(start, i));
        proxy.write(Buffer.from([0x7f]));
        start = i + 1;
      }
    }
    if (start < buf.length) proxy.write(buf.slice(start));
  });
  real.on("end", () => proxy.end());

  return proxy as unknown as NodeJS.ReadStream;
}

function buildBanner(leaderTools: number, totalTools: number, model: string): string {
  const cols = process.stdout.columns ?? 100;
  const width = Math.min(cols - 2, 120);
  const leftW = 40;
  const rightW = width - leftW - 4;
  const g = chalk.gray;
  const c = chalk.bold.cyan;
  const w = chalk.white;
  const dim = chalk.dim;

  const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - stripAnsi(s).length));
  const center = (s: string, len: number) => {
    const stripped = stripAnsi(s);
    const left = Math.floor((len - stripped.length) / 2);
    return " ".repeat(Math.max(0, left)) + s + " ".repeat(Math.max(0, len - stripped.length - left));
  };

  const cwd = process.cwd();
  const title = `Atlas v1.0.0`;
  const hr = "─".repeat(rightW);

  const leftLines = [
    "",
    c("      ▀▀▀▀▀"),
    c("      █ ▀ █"),
    c("      █▀▀▀█"),
    c("      █   █"),
    "",
    w(`${model} • ${leaderTools}/${totalTools} tools`),
    dim(cwd.length > leftW - 4 ? "~/" + cwd.split("/").slice(-2).join("/") : cwd),
  ];

  const rightLines = [
    w("Tips for getting started"),
    g(`Run /init to create an ATLAS.md with project instructions`),
    g(hr),
    w("Commands"),
    g(`/help · /plan · /model · /agent · /doctor · /cost`),
    g(hr),
    g(`/help for full list · Tab to complete · Ctrl+C to exit`),
  ];

  const maxLines = Math.max(leftLines.length, rightLines.length);
  const topBorder = `╭─── ${c(title)} ${"─".repeat(Math.max(0, width - title.length - 6))}╮`;
  const botBorder = `╰${"─".repeat(width - 1)}╯`;
  const lines = ["", topBorder];

  for (let i = 0; i < maxLines; i++) {
    const left = center(leftLines[i] ?? "", leftW);
    const right = pad(rightLines[i] ?? "", rightW);
    lines.push(`│${left}│  ${right}│`);
  }
  lines.push(botBorder, "");
  return lines.join("\n");
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export async function startTui(params: {
  provider: OpenAIProvider;
  toolRegistry: ToolRegistry;
  executor: ToolExecutor;
  systemPrompt?: string;
  initialSession?: Session;
  projectContextPath?: string;
  commands?: CustomCommand[];
  subagents?: SubagentProfile[];
  hooks?: HooksConfig;
  totalToolCount?: number;
  fastModel?: string;
  startInPlanMode?: boolean;
  skills?: Skill[];
  theme?: string;
  mcpStatus?: Array<{ name: string; command: string; status: "connected" | "failed"; toolCount: number; error?: string }>;
}): Promise<void> {
  process.env.__ATLAS_INK_MODE = "1";
  const leaderTools = params.toolRegistry.getAll().length;
  const bannerText = buildBanner(leaderTools, params.totalToolCount ?? leaderTools, params.provider.getModel());
  const imeStdin = createImeAwareStdin(process.stdin as NodeJS.ReadStream);
  const { waitUntilExit } = render(
    <App
      bannerText={bannerText}
      mcpStatus={params.mcpStatus}
      provider={params.provider}
      toolRegistry={params.toolRegistry}
      executor={params.executor}
      systemPrompt={params.systemPrompt}
      initialSession={params.initialSession}
      projectContextPath={params.projectContextPath}
      commands={params.commands}
      subagents={params.subagents}
      hooks={params.hooks}
      totalToolCount={params.totalToolCount}
      fastModel={params.fastModel}
      startInPlanMode={params.startInPlanMode}
      skills={params.skills}
      theme={params.theme}
    />,
    { stdin: imeStdin }
  );
  await waitUntilExit();
}
