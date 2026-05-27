import { createInterface } from "node:readline";
import type { AnthropicProvider } from "./provider/anthropic.js";
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

export async function startRepl(params: {
  provider: AnthropicProvider;
  toolRegistry: ToolRegistry;
  executor: ToolExecutor;
  systemPrompt?: string;
  initialSession?: Session;
  projectContextPath?: string;
  commands?: import("./commands.js").CustomCommand[];
  compactionConfig?: CompactionConfig;
  startInPlanMode?: boolean;
  subagents?: SubagentProfile[];
}): Promise<void> {
  const { provider, toolRegistry, executor, systemPrompt, initialSession, projectContextPath, commands, startInPlanMode } = params;
  const compactionCfg = params.compactionConfig ?? DEFAULT_COMPACTION_CONFIG;

  const planMode = new PlanMode();
  if (startInPlanMode) {
    planMode.enter();
    console.log("[Plan mode ON — agent can only read, not modify]");
  }

  const toolCount = toolRegistry.getAll().length;
  const model = provider.getModel();

  console.log(`atlas-agent v0.1.0 | ${toolCount} tools | model: ${model}`);
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

    if (input === "/help") {
      console.log("Commands:");
      console.log("  /save       — Save current session");
      console.log("  /sessions   — List saved sessions");
      console.log("  /load <id>  — Load a saved session");
      console.log("  /clear      — Clear history, start fresh");
      console.log("  /plan       — Enter plan mode (read-only, no modifications)");
      console.log("  /execute    — Exit plan mode (allow modifications)");
      console.log("  /compact    — Compact conversation history");
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
        messages.push({ role: "user", content: subInput.trim() });
      } else {
        messages.push({ role: "user", content: userPrompt });
      }

      const controller = new AbortController();
      const onSigint = () => controller.abort();
      process.on("SIGINT", onSigint);

      try {
        await runAgentLoop({
          provider,
          messages,
          toolRegistry: filteredRegistry,
          executor,
          systemPrompt: profile.systemPrompt,
          abortSignal: controller.signal,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\nError: ${msg}`);
      } finally {
        process.removeListener("SIGINT", onSigint);
      }

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
        messages.push({ role: "user", content: fullPrompt });

        const controller = new AbortController();
        const onSigint = () => controller.abort();
        process.on("SIGINT", onSigint);

        try {
          await runAgentLoop({
            provider,
            messages,
            toolRegistry: planMode.isActive() ? planMode.filterRegistry(toolRegistry) : toolRegistry,
            executor,
            systemPrompt,
            abortSignal: controller.signal,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`\nError: ${msg}`);
        } finally {
          process.removeListener("SIGINT", onSigint);
        }

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

    const userContent = planMode.isActive()
      ? "[PLAN MODE: You can only read and analyze. Do NOT suggest tool calls for write_file, edit_file, or bash. Design your approach and explain what changes you would make.]\n\n" + trimmed
      : trimmed;

    messages.push({ role: "user", content: userContent });

    const controller = new AbortController();
    const onSigint = () => controller.abort();
    process.on("SIGINT", onSigint);

    try {
      await runAgentLoop({
        provider,
        messages,
        toolRegistry: planMode.isActive() ? planMode.filterRegistry(toolRegistry) : toolRegistry,
        executor,
        systemPrompt,
        abortSignal: controller.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\nError: ${msg}`);
    } finally {
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

  rl.close();
}
