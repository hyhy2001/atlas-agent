import { createInterface } from "node:readline";
import type { AnthropicProvider } from "./provider/anthropic.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { ToolExecutor } from "./tools/executor.js";
import type { MessageParam } from "./provider/types.js";
import { runAgentLoop } from "./agent/loop.js";
import {
  generateSessionId,
  saveSession,
  loadSession,
  listSessions,
  type Session,
} from "./sessions.js";

export async function startRepl(params: {
  provider: AnthropicProvider;
  toolRegistry: ToolRegistry;
  executor: ToolExecutor;
  systemPrompt?: string;
  initialSession?: Session;
  projectContextPath?: string;
}): Promise<void> {
  const { provider, toolRegistry, executor, systemPrompt, initialSession, projectContextPath } = params;

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

  const prompt = (): Promise<string | null> =>
    new Promise((resolve) => {
      rl.question("> ", (answer) => {
        resolve(answer);
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

    if (input === "/help") {
      console.log("Commands:");
      console.log("  /save       — Save current session");
      console.log("  /sessions   — List saved sessions");
      console.log("  /load <id>  — Load a saved session");
      console.log("  /clear      — Clear history, start fresh");
      console.log("  /help       — Show this help");
      console.log("  /context    — Show loaded project context path");
      return true;
    }

    return false;
  }

  while (true) {
    const input = await prompt();

    if (input === null) break;

    const trimmed = input.trim();
    if (!trimmed) continue;
    if (trimmed === "exit" || trimmed === "quit") break;

    if (trimmed.startsWith("/")) {
      const handled = await handleCommand(trimmed);
      if (handled) continue;
    }

    messages.push({ role: "user", content: trimmed });

    const controller = new AbortController();
    const onSigint = () => controller.abort();
    process.on("SIGINT", onSigint);

    try {
      await runAgentLoop({
        provider,
        messages,
        toolRegistry,
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

    // Auto-save after each agent turn (fire-and-forget)
    saveSession(buildSession()).catch(() => {});

    process.stdout.write("\n");
  }

  rl.close();
}
