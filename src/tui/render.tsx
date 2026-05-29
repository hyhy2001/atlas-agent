import React from "react";
import { render } from "ink";
import { App } from "./App.js";
import type { OpenAIProvider } from "../provider/openai.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolExecutor } from "../tools/executor.js";
import type { Session } from "../sessions.js";
import type { CustomCommand } from "../commands.js";
import type { SubagentProfile } from "../agent/subagents.js";
import type { HooksConfig } from "../hooks.js";

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
