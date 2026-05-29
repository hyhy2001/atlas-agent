import React from "react";
import { render } from "ink";
import chalk from "chalk";
import { App } from "./App.js";
import type { OpenAIProvider } from "../provider/openai.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolExecutor } from "../tools/executor.js";
import type { Session } from "../sessions.js";
import type { CustomCommand } from "../commands.js";
import type { SubagentProfile } from "../agent/subagents.js";
import type { HooksConfig } from "../hooks.js";

function printBanner(leaderTools: number, totalTools: number, model: string): void {
  const c = chalk.bold.cyan;
  process.stdout.write("\n");
  process.stdout.write(c(" █████╗ ████████╗██╗      █████╗ ███████╗") + "\n");
  process.stdout.write(c("██╔══██╗╚══██╔══╝██║     ██╔══██╗██╔════╝") + "\n");
  process.stdout.write(c("███████║   ██║   ██║     ███████║███████╗") + "\n");
  process.stdout.write(c("██╔══██║   ██║   ██║     ██╔══██║╚════██║") + "\n");
  process.stdout.write(c("██║  ██║   ██║   ███████╗██║  ██║███████║") + "\n");
  process.stdout.write(c("╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚══════╝") + "\n");
  process.stdout.write(chalk.gray(`  AI Coding Assistant • v1.0.0 • ${leaderTools} leader / ${totalTools} total tools`) + "\n");
  process.stdout.write(chalk.gray(`  Model: ${model}`) + "\n");
  process.stdout.write(chalk.gray(`  Type /help for commands, "exit" to quit`) + "\n\n");
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
}): Promise<void> {
  process.env.__ATLAS_INK_MODE = "1";
  const leaderTools = params.toolRegistry.getAll().length;
  printBanner(leaderTools, params.totalToolCount ?? leaderTools, params.provider.getModel());
  const { waitUntilExit } = render(
    <App
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
    />
  );
  await waitUntilExit();
}
