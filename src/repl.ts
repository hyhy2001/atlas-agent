import { createInterface } from "node:readline";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenAIProvider } from "./provider/openai.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { ToolExecutor } from "./tools/executor.js";
import type { MessageParam } from "./provider/types.js";
import { runAgentLoop } from "./agent/loop.js";
import {
  shouldCompact,
  compactMessages,
  DEFAULT_COMPACTION_CONFIG,
  type CompactionConfig,
} from "./agent/compaction.js";
import {
  generateSessionId,
  saveSession,
  loadSession,
  listSessions,
  type Session,
} from "./sessions.js";
import { PlanMode } from "./agent/plan_mode.js";
import chalk from "chalk";
import { isMultilineStart, isMultilineEnd, shouldContinue, stripContinuation } from "./multiline.js";
import { filterRegistryForSubagent, getSubagent, listSubagents, type SubagentProfile } from "./agent/subagents.js";
import { runLifecycleHooks, type HooksConfig } from "./hooks.js";

export async function startRepl(params: {
  provider: OpenAIProvider;
  toolRegistry: ToolRegistry;
  executor: ToolExecutor;
  systemPrompt?: string;
  initialSession?: Session;
  projectContextPath?: string;
  commands?: import("./commands.js").CustomCommand[];
  compactionConfig?: CompactionConfig;
  startInPlanMode?: boolean;
  subagents?: SubagentProfile[];
  fastModel?: string;
  hooks?: HooksConfig;
  totalToolCount?: number;
}): Promise<void> {
  const { provider, toolRegistry, executor, systemPrompt, initialSession, projectContextPath, commands, startInPlanMode, hooks } = params;
  const compactionCfg = params.compactionConfig ?? DEFAULT_COMPACTION_CONFIG;

  const planMode = new PlanMode();
  if (startInPlanMode) {
    planMode.enter();
    console.log("[Plan mode ON — agent can only read, not modify]");
  }

  const leaderTools = toolRegistry.getAll().length;
  const totalTools = params.totalToolCount ?? leaderTools;
  const model = provider.getModel();

  console.log(`atlas-agent v0.1.0 | ${leaderTools} leader / ${totalTools} total tools | model: ${model}`);
  console.log('Type "exit" or "quit" to leave. /help for commands.\n');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let messages: MessageParam[] = initialSession?.messages ?? [];
  let currentSessionId = initialSession?.id ?? generateSessionId();
  const sessionCreatedAt = initialSession?.createdAt ?? new Date().toISOString();

  const readInput = (): Promise<string | null> =>
    new Promise((resolve) => {
      const planPrefix = planMode.isActive() ? "[plan] " : "";
      rl.question(`${planPrefix}> `, (firstLine) => {
        if (firstLine === null) { resolve(null); return; }
        const trimmed = firstLine.trim();

        // Triple backtick mode
        if (isMultilineStart(trimmed)) {
          const lines: string[] = [];
          process.stdout.write(chalk.gray("... "));
          const collectLine = () => {
            rl.question("... ", (line) => {
              if (isMultilineEnd(line.trim())) {
                resolve(lines.join("\n"));
              } else {
                lines.push(line);
                collectLine();
              }
            });
          };
          collectLine();
          return;
        }

        // Backslash continuation
        if (shouldContinue(trimmed)) {
          const lines: string[] = [stripContinuation(trimmed)];
          const collectLine = () => {
            rl.question("... ", (line) => {
              if (shouldContinue(line.trim())) {
                lines.push(stripContinuation(line.trim()));
                collectLine();
              } else {
                lines.push(line);
                resolve(lines.join("\n"));
              }
            });
          };
          collectLine();
          return;
        }

        resolve(firstLine);
      });
      rl.once("close", () => resolve(null));
    });

  function buildSession(): Session {
    return {
      id: currentSessionId,
      createdAt: sessionCreatedAt,
      updatedAt: new Date().toISOString(),
      model,
      messageCount: messages.length,
      messages,
    };
  }

  function getFirstUserMessage(msgs: MessageParam[]): string {
    for (const m of msgs) {
      if (m.role === "user" && typeof m.content === "string") {
        return m.content.length > 60 ? m.content.slice(0, 60) + "..." : m.content;
      }
    }
    return "(no user message)";
  }

  async function processAtMentions(input: string, cwd: string): Promise<string> {
    const atPattern = /@([\w./\-]+\.\w+)/g;
    let result = input;
    const matches = [...input.matchAll(atPattern)];

    for (const match of matches) {
      const filePath = path.resolve(cwd, match[1]);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.split("\n");
        const preview = lines.length > 200 ? lines.slice(0, 200).join("\n") + "\n... (truncated)" : content;
        result = result.replace(match[0], `\n\n<file path="${match[1]}">\n${preview}\n</file>\n`);
      } catch {
        // leave as-is
      }
    }

    return result;
  }

  function formatTokenCount(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  let sessionInputTokens = 0;
  let sessionOutputTokens = 0;

  await runLifecycleHooks(hooks?.SessionStart ?? [], { ATLAS_SESSION_ID: currentSessionId, ATLAS_CWD: process.cwd(), ATLAS_MODEL: model });

  let isAgentRunning = false;
  let ctrlCPressedAt: number | null = null;
  const controllerRef: { current: AbortController | null } = { current: null };

  process.on("SIGINT", () => {
    if (isAgentRunning) {
      controllerRef.current?.abort();
      process.stdout.write("\n[Interrupted]\n");
      return;
    }
    const now = Date.now();
    if (ctrlCPressedAt && now - ctrlCPressedAt < 3000) {
      process.stdout.write("\n");
      rl.close();
      process.exit(0);
    }
    ctrlCPressedAt = now;
    process.stdout.write("\n(Press Ctrl+C again to exit)\n");
    rl.prompt?.();
  });

  async function handleCommand(input: string): Promise<boolean> {
    if (input === "/save") {
      const session = buildSession();
      await saveSession(session);
      const os = await import("node:os");
      const path = await import("node:path");
      const filePath = path.join(os.homedir(), ".config", "atlas-agent", "sessions", `${currentSessionId}.json`);
      console.log(`Session saved: ${filePath}`);
      return true;
    }

    if (input === "/sessions") {
      const sessions = await listSessions();
      if (sessions.length === 0) {
        console.log("No saved sessions.");
      } else {
        for (const s of sessions) {
          const date = s.updatedAt.slice(0, 10);
          console.log(`  ${s.id}  ${date}  ${s.messageCount} msgs`);
        }
      }
      return true;
    }

    if (input.startsWith("/load ")) {
      const id = input.slice(6).trim();
      if (!id) {
        console.log("Usage: /load <session-id>");
        return true;
      }
      const session = await loadSession(id);
      if (!session) {
        console.log(`Session not found: ${id}`);
        return true;
      }
      messages = session.messages;
      currentSessionId = session.id;
      console.log(`Loaded session ${id} (${session.messageCount} messages)`);
      const preview = getFirstUserMessage(messages);
      console.log(`  First message: ${preview}`);
      return true;
    }

    if (input === "/clear") {
      messages = [];
      currentSessionId = generateSessionId();
      console.log("History cleared. Starting fresh session.");
      return true;
    }

    if (input === "/context") {
      if (projectContextPath) {
        console.log(`Project context: ${projectContextPath}`);
      } else {
        console.log("No project context loaded");
      }
      return true;
    }

    if (input === "/plan") {
      planMode.enter();
      console.log("[Plan mode ON — agent can only read, not modify]");
      return true;
    }

    if (input === "/execute" || input === "/do") {
      planMode.exit();
      console.log("[Plan mode OFF — agent can now modify files]");
      return true;
    }

    if (input === "/compact") {
      const before = messages.length;
      messages = await compactMessages({ messages, provider, config: compactionCfg });
      console.log(`[Compacted: ${before} messages → ${messages.length} messages]`);
      return true;
    }

    if (input === "/cost") {
      const inCost = (sessionInputTokens / 1_000_000) * 1.5;
      const outCost = (sessionOutputTokens / 1_000_000) * 15.0;
      const total = inCost + outCost;
      const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
      console.log(`Token usage this session:`);
      console.log(`  Input:  ${fmt(sessionInputTokens)} tokens  (~$${inCost.toFixed(3)})`);
      console.log(`  Output: ${fmt(sessionOutputTokens)} tokens  (~$${outCost.toFixed(3)})`);
      console.log(`  Total:  ${fmt(sessionInputTokens + sessionOutputTokens)} tokens  (~$${total.toFixed(3)})`);
      return true;
    }

    if (input === "/init" || input === "/init --force") {
      const force = input.includes("--force");
      const atlasPath = path.join(process.cwd(), "ATLAS.md");
      if (!force) {
        try {
          const { access } = await import("node:fs/promises");
          await access(atlasPath);
          console.log("ATLAS.md already exists. Use /init --force to overwrite.");
          return true;
        } catch {}
      }
      console.log("Generating ATLAS.md...");
      const initPrompt = `Scan this project and generate an ATLAS.md file. Include:
1. Project overview (what it does, tech stack)
2. Directory structure (key directories)
3. Key files and their roles
4. How to build and run
5. Common development tasks

Use list_directory and read_file to explore, then write_file to create ATLAS.md.
Keep it under 150 lines, concise and useful as AI context.`;
      messages.push({ role: "user", content: initPrompt });
      const controller = new AbortController();
      try {
        await runAgentLoop({ provider, messages, toolRegistry, executor, systemPrompt, abortSignal: controller.signal });
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.stdout.write("\n");
      return true;
    }

    if (input === "/help") {
      console.log("Commands:");
      console.log("  /save       — Save current session");
      console.log("  /sessions   — List saved sessions");
      console.log("  /load <id>  — Load a saved session");
      console.log("  /clear      — Clear history, start fresh");
      console.log("  /plan       — Enter plan mode (read-only, no modifications)");
      console.log("  /execute    — Exit plan mode (allow modifications)");
      console.log("  /compact    — Compact conversation history");
      console.log("  /cost       — Show token usage and estimated cost");
      console.log("  /init       — Generate ATLAS.md for this project");
      console.log("  /context    — Show loaded project context path");
      console.log("  /agent <name>  — Invoke a subagent for one turn");
      console.log("  /agents        — List available subagents");
      console.log("  /help       — Show this help");
      console.log("\nMulti-line: type ``` to start/end a block, or end a line with \\ to continue");
      if (commands && commands.length > 0) {
        console.log("\nCustom commands:");
        for (const cmd of commands) {
          const desc = cmd.description ? ` — ${cmd.description}` : "";
          console.log(`  /${cmd.name}${desc}`);
        }
      }
      console.log("\n  @file.ts    — Inject file content into your prompt (e.g. @src/cli.ts)");
      return true;
    }

    if (input === "/agents") {
      const allAgents = params.subagents ?? listSubagents();
      console.log("Available agents:");
      for (const agent of allAgents) {
        console.log(`  ${agent.name}  — ${agent.description}`);
      }
      return true;
    }

    if (input.startsWith("/agent ") || input === "/agent") {
      const rest = input.slice(7).trim();
      const spaceIdx = rest.indexOf(" ");
      const agentName = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
      const agentPrompt = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1).trim();

      if (!agentName) {
        const allAgents = params.subagents ?? listSubagents();
        console.log("Usage: /agent <name> [prompt]");
        console.log("Available agents:");
        for (const agent of allAgents) {
          console.log(`  ${agent.name}  — ${agent.description}`);
        }
        return true;
      }

      const allAgents = params.subagents ?? listSubagents();
      const profile = allAgents.find((a) => a.name === agentName);
      if (!profile) {
        console.log(`Unknown agent: ${agentName}`);
        console.log("Available agents:");
        for (const agent of allAgents) {
          console.log(`  ${agent.name}  — ${agent.description}`);
        }
        return true;
      }

      const filteredRegistry = filterRegistryForSubagent(toolRegistry, profile);
      const userPrompt = agentPrompt || null;

      if (!userPrompt) {
        console.log(`[${profile.name}] Enter your prompt:`);
        const subInput = await readInput();
        if (!subInput || !subInput.trim()) {
          console.log("No input provided, cancelled.");
          return true;
        }
        await runLifecycleHooks(hooks?.UserPromptSubmit ?? [], { ATLAS_PROMPT: subInput.trim().slice(0, 500) });
        const processed = await processAtMentions(subInput.trim(), process.cwd());
        messages.push({ role: "user", content: processed });
      } else {
        await runLifecycleHooks(hooks?.UserPromptSubmit ?? [], { ATLAS_PROMPT: userPrompt.slice(0, 500) });
        const processed = await processAtMentions(userPrompt, process.cwd());
        messages.push({ role: "user", content: processed });
      }

      const controller = new AbortController();
      const onSigint = () => controller.abort();
      process.on("SIGINT", onSigint);

      try {
        isAgentRunning = true;
        controllerRef.current = controller;
        const subProvider = profile.model
          ? provider.withModel(profile.model)
          : params.fastModel
            ? provider.withModel(params.fastModel)
            : provider;

        const result = await runAgentLoop({
          provider: subProvider,
          messages,
          toolRegistry: filteredRegistry,
          executor,
          systemPrompt: profile.systemPrompt,
          abortSignal: controller.signal,
        });
        sessionInputTokens += result.inputTokens;
        sessionOutputTokens += result.outputTokens;
        console.log(chalk.gray(`\n[tokens: ${formatTokenCount(result.inputTokens)} in / ${formatTokenCount(result.outputTokens)} out | session: ${formatTokenCount(sessionInputTokens)} in / ${formatTokenCount(sessionOutputTokens)} out]`));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\nError: ${msg}`);
      } finally {
        isAgentRunning = false;
        controllerRef.current = null;
        process.removeListener("SIGINT", onSigint);
      }

      await runLifecycleHooks(hooks?.Stop ?? [], { ATLAS_SESSION_ID: currentSessionId });
      saveSession(buildSession()).catch(() => {});
      process.stdout.write("\n");
      return true;
    }

    // Custom commands
    if (commands && commands.length > 0) {
      const withoutSlash = input.slice(1);
      const spaceIdx = withoutSlash.indexOf(" ");
      const cmdName = spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx);
      const cmdArgs = spaceIdx === -1 ? "" : withoutSlash.slice(spaceIdx + 1).trim();

      const matched = commands.find((c) => c.name === cmdName);
      if (matched) {
        let fullPrompt = matched.promptBody;
        if (cmdArgs) {
          fullPrompt += `\n\nUser argument: ${cmdArgs}`;
        }
        await runLifecycleHooks(hooks?.UserPromptSubmit ?? [], { ATLAS_PROMPT: fullPrompt.slice(0, 500) });
        const processedPrompt = await processAtMentions(fullPrompt, process.cwd());
        messages.push({ role: "user", content: processedPrompt });

        const controller = new AbortController();
        const onSigint = () => controller.abort();
        process.on("SIGINT", onSigint);

        try {
          isAgentRunning = true;
          controllerRef.current = controller;
          const result = await runAgentLoop({
            provider,
            messages,
            toolRegistry: planMode.isActive() ? planMode.filterRegistry(toolRegistry) : toolRegistry,
            executor,
            systemPrompt,
            abortSignal: controller.signal,
          });
          sessionInputTokens += result.inputTokens;
          sessionOutputTokens += result.outputTokens;
          console.log(chalk.gray(`\n[tokens: ${formatTokenCount(result.inputTokens)} in / ${formatTokenCount(result.outputTokens)} out | session: ${formatTokenCount(sessionInputTokens)} in / ${formatTokenCount(sessionOutputTokens)} out]`));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`\nError: ${msg}`);
        } finally {
          isAgentRunning = false;
          controllerRef.current = null;
          process.removeListener("SIGINT", onSigint);
        }

        await runLifecycleHooks(hooks?.Stop ?? [], { ATLAS_SESSION_ID: currentSessionId });
        saveSession(buildSession()).catch(() => {});
        process.stdout.write("\n");
        return true;
      }
    }

    return false;
  }

  while (true) {
    const input = await readInput();

    if (input === null) break;

    const trimmed = input.trim();
    if (!trimmed) continue;
    if (trimmed === "exit" || trimmed === "quit") break;

    if (trimmed.startsWith("/")) {
      const handled = await handleCommand(trimmed);
      if (handled) continue;
    }

    await runLifecycleHooks(hooks?.UserPromptSubmit ?? [], { ATLAS_PROMPT: trimmed.slice(0, 500) });
    const processedContent = await processAtMentions(trimmed, process.cwd());
    const userContent = planMode.isActive()
      ? "[PLAN MODE: You can only read and analyze. Do NOT suggest tool calls for write_file, edit_file, or bash. Design your approach and explain what changes you would make.]\n\n" + processedContent
      : processedContent;

    messages.push({ role: "user", content: userContent });

    const controller = new AbortController();
    const onSigint = () => controller.abort();
    process.on("SIGINT", onSigint);

    try {
      isAgentRunning = true;
      controllerRef.current = controller;
      const result = await runAgentLoop({
        provider,
        messages,
        toolRegistry: planMode.isActive() ? planMode.filterRegistry(toolRegistry) : toolRegistry,
        executor,
        systemPrompt,
        abortSignal: controller.signal,
      });
      sessionInputTokens += result.inputTokens;
      sessionOutputTokens += result.outputTokens;
      console.log(chalk.gray(`\n[tokens: ${formatTokenCount(result.inputTokens)} in / ${formatTokenCount(result.outputTokens)} out | session: ${formatTokenCount(sessionInputTokens)} in / ${formatTokenCount(sessionOutputTokens)} out]`));
      await runLifecycleHooks(hooks?.Stop ?? [], { ATLAS_SESSION_ID: currentSessionId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\nError: ${msg}`);
    } finally {
      isAgentRunning = false;
      controllerRef.current = null;
      process.removeListener("SIGINT", onSigint);
    }

    // Auto-compact if over threshold
    if (shouldCompact(messages, compactionCfg)) {
      const before = messages.length;
      messages = await compactMessages({ messages, provider, config: compactionCfg });
      console.log(`[Compacted: ${before} messages → ${messages.length} messages]`);
    }

    // Auto-save after each agent turn (fire-and-forget)
    saveSession(buildSession()).catch(() => {});

    process.stdout.write("\n");
  }

  await runLifecycleHooks(hooks?.SessionEnd ?? [], { ATLAS_SESSION_ID: currentSessionId, ATLAS_CWD: process.cwd() });
  rl.close();
}
