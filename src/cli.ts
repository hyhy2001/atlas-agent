import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { AnthropicProvider } from "./provider/anthropic.js";
import { McpClient } from "./mcp/client.js";
import { ToolRegistry } from "./tools/registry.js";
import { ToolExecutor } from "./tools/executor.js";
import { builtinTools } from "./tools/builtin/index.js";
import { PermissionSession } from "./permissions/session.js";
import { startRepl } from "./repl.js";
import { DEFAULT_SYSTEM_PROMPT } from "./agent/system_prompt.js";
import { loadSession } from "./sessions.js";
import { loadProjectContext, findProjectContextPath } from "./agent/context_loader.js";
import type { ExecutionContext } from "./tools/types.js";

function parseArgs(argv: string[]): { model?: string; debug?: boolean; config?: string; systemPrompt?: string; systemPromptFile?: string; resume?: string } {
  const result: { model?: string; debug?: boolean; config?: string; systemPrompt?: string; systemPromptFile?: string; resume?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--model" && argv[i + 1]) {
      result.model = argv[++i];
    } else if (arg === "--debug") {
      result.debug = true;
    } else if (arg === "--config" && argv[i + 1]) {
      result.config = argv[++i];
    } else if (arg === "--system-prompt" && argv[i + 1]) {
      result.systemPrompt = argv[++i];
    } else if (arg === "--system-prompt-file" && argv[i + 1]) {
      result.systemPromptFile = argv[++i];
    } else if (arg === "--resume" && argv[i + 1]) {
      result.resume = argv[++i];
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv);

  const config = loadConfig(args.model ? { model: args.model } : undefined);

  // Resolve system prompt: default → config → env → --system-prompt → --system-prompt-file
  let systemPrompt: string = DEFAULT_SYSTEM_PROMPT;
  if (config.systemPrompt) {
    systemPrompt = config.systemPrompt;
  }
  if (args.systemPrompt) {
    systemPrompt = args.systemPrompt;
  }
  if (args.systemPromptFile) {
    systemPrompt = readFileSync(args.systemPromptFile, "utf-8");
  }

  // Append project context (CLAUDE.md / AGENT.md) if found
  const projectContextPath = await findProjectContextPath(process.cwd());
  const projectContext = await loadProjectContext(process.cwd());
  if (projectContext && projectContextPath) {
    systemPrompt += `\n\n# Project Instructions\n\n${projectContext}`;
    console.log(`Loaded project context from ${projectContextPath}`);
  }

  const apiKey = config.authToken || process.env["ANTHROPIC_API_KEY"] || "";
  if (!apiKey) {
    console.error(
      "Error: No API key found. Set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN environment variable,\n" +
        "or add authToken to ~/.config/atlas-agent/config.json"
    );
    process.exit(1);
  }

  // Handle --resume flag
  let initialSession;
  if (args.resume) {
    const session = await loadSession(args.resume);
    if (!session) {
      console.error(`Error: Session not found: ${args.resume}`);
      process.exit(1);
    }
    console.log(`Resuming session ${session.id} (${session.messageCount} messages)`);
    initialSession = session;
  }

  const provider = new AnthropicProvider({
    apiKey,
    model: config.model,
    baseURL: config.baseURL,
  });

  const mcpClients: McpClient[] = [];
  for (const serverConfig of config.mcpServers) {
    const client = await McpClient.create(serverConfig);
    if (client) {
      mcpClients.push(client);
    }
  }

  const toolRegistry = new ToolRegistry();
  toolRegistry.registerAll(builtinTools);

  for (const client of mcpClients) {
    toolRegistry.registerAll(client.getTools());
  }

  const permissions = new PermissionSession();
  const ctx: ExecutionContext = {
    workingDir: process.cwd(),
    abortSignal: new AbortController().signal,
    permissions,
  };

  const executor = new ToolExecutor(toolRegistry, ctx);

  const cleanup = async () => {
    for (const client of mcpClients) {
      await client.close();
    }
  };

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(0);
  });

  try {
    await startRepl({
      provider,
      toolRegistry,
      executor,
      systemPrompt,
      initialSession,
    });
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
