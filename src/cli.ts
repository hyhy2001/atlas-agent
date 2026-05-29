import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { OpenAIProvider } from "./provider/openai.js";
import { McpClient } from "./mcp/client.js";
import { ToolRegistry } from "./tools/registry.js";
import { ToolExecutor } from "./tools/executor.js";
import { builtinTools } from "./tools/builtin/index.js";
import { PermissionSession } from "./permissions/session.js";
import { startRepl } from "./repl.js";
import { startTui } from "./tui/render.js";
import { runHeadless } from "./headless.js";
import { DEFAULT_SYSTEM_PROMPT } from "./agent/system_prompt.js";
import { listSessions, loadSession } from "./sessions.js";
import { loadProjectContext, findProjectContextPath } from "./agent/context_loader.js";
import { loadCommands } from "./commands.js";
import { loadCustomSubagents, BUILTIN_SUBAGENTS } from "./agent/subagents.js";
import { interactiveLogin, hasCredentials } from "./login.js";
import type { ExecutionContext } from "./tools/types.js";

function parseArgs(argv: string[]): {
  model?: string;
  debug?: boolean;
  config?: string;
  systemPrompt?: string;
  systemPromptFile?: string;
  resume?: string;
  plan?: boolean;
  print?: string;
  yes?: boolean;
  continue?: boolean;
  json?: boolean;
} {
  const result: {
    model?: string;
    debug?: boolean;
    config?: string;
    systemPrompt?: string;
    systemPromptFile?: string;
    resume?: string;
    plan?: boolean;
    print?: string;
    yes?: boolean;
    continue?: boolean;
    json?: boolean;
  } = {};

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
    } else if (arg === "--plan") {
      result.plan = true;
    } else if ((arg === "-p" || arg === "--print") && argv[i + 1]) {
      result.print = argv[++i];
    } else if (arg === "-y" || arg === "--yes") {
      result.yes = true;
    } else if (arg === "--continue") {
      result.continue = true;
    } else if (arg === "--json") {
      result.json = true;
    }
  }

  return result;
}

async function main() {
  const argv = process.argv.slice(2);

  // Subcommand: mcp
  if (argv[0] === "mcp") {
    const { listMcpServers, addMcpServer, removeMcpServer } = await import("./mcp/manage.js");
    const subcmd = argv[1];
    if (subcmd === "list") {
      await listMcpServers();
    } else if (subcmd === "add") {
      const name = argv[2];
      const command = argv[3];
      const args = argv.slice(4);
      if (!name || !command) {
        console.error("Usage: atlas-agent mcp add <name> <command> [args...]");
        process.exit(1);
      }
      await addMcpServer(name, command, args);
    } else if (subcmd === "remove" || subcmd === "rm") {
      const name = argv[2];
      if (!name) {
        console.error("Usage: atlas-agent mcp remove <name>");
        process.exit(1);
      }
      await removeMcpServer(name);
    } else {
      console.error("Usage: atlas-agent mcp <list|add|remove> [args...]");
      process.exit(1);
    }
    return;
  }

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

  // Append project context if found
  const projectContextPath = await findProjectContextPath(process.cwd());
  const projectContext = await loadProjectContext(process.cwd());
  if (projectContext && projectContextPath) {
    systemPrompt += `\n\n# Project Instructions\n\n${projectContext}`;
    console.log(`Loaded project context from ${projectContextPath}`);
  }

  const { loadAllMemory, formatMemoryForPrompt } = await import("./memory.js");
  const memory = await loadAllMemory(process.cwd());
  if (memory.length > 0) {
    systemPrompt += formatMemoryForPrompt(memory);
    console.log(`Loaded ${memory.length} memory entries`);
  }

  let apiKey = config.authToken || process.env["ATLAS_API_KEY"] || "";
  let baseURLOverride = config.baseURL;

  if (!apiKey) {
    const creds = await interactiveLogin();
    if (!creds) {
      console.error("Login cancelled.");
      process.exit(1);
    }
    apiKey = creds.authToken;
    baseURLOverride = creds.baseURL;
    // Reload config to pick up saved credentials
    const updatedConfig = loadConfig(args.model ? { model: args.model } : undefined);
    if (!apiKey) apiKey = updatedConfig.authToken || "";
  }

  // Handle --continue / --resume flags
  let initialSession;
  if (args.continue && !args.resume) {
    const sessions = await listSessions();
    if (sessions.length > 0) {
      const last = sessions[0];
      const session = await loadSession(last.id);
      if (session) {
        console.log(`Resuming last session ${session.id} (${session.messageCount} messages)`);
        initialSession = session;
      }
    }
  }

  if (args.resume) {
    const session = await loadSession(args.resume);
    if (!session) {
      console.error(`Error: Session not found: ${args.resume}`);
      process.exit(1);
    }
    console.log(`Resuming session ${session.id} (${session.messageCount} messages)`);
    initialSession = session;
  }

  const provider = new OpenAIProvider({
    apiKey,
    model: config.model,
    baseURL: baseURLOverride || config.baseURL,
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

  const leaderRegistry = toolRegistry.filterForLeader();

  const permissions = new PermissionSession();
  const ctx: ExecutionContext = {
    workingDir: process.cwd(),
    abortSignal: new AbortController().signal,
    permissions,
  };

  // Load settings config (global + project)
  const { loadSettings } = await import("./hooks.js");
  const settings = await loadSettings(process.cwd());
  const hooks = settings.hooks;
  permissions.grantAll(settings.allowedTools);

  // Attach provider/registry/hooks to ctx for delegate tool
  (ctx as any)._provider = provider;
  (ctx as any)._registry = toolRegistry;
  (ctx as any)._hooks = hooks;
  (ctx as any)._fastModel = config.fastModel;
  (ctx as any)._reasoningModel = config.reasoningModel;
  (ctx as any)._trustedDirs = config.trustedDirs;

  const executor = new ToolExecutor(toolRegistry, ctx, hooks);

  const cleanup = async () => {
    for (const client of mcpClients) {
      await client.close();
    }
  };

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(0);
  });

  // Load custom commands
  const commands = await loadCommands(process.cwd());
  if (commands.length > 0) {
    console.log(`Loaded ${commands.length} custom commands`);
  }

  const customAgents = await loadCustomSubagents(process.cwd());
  const map = new Map<string, import("./agent/subagents.js").SubagentProfile>();
  for (const a of BUILTIN_SUBAGENTS) map.set(a.name, a);
  for (const a of customAgents) map.set(a.name, a);  // override
  const subagents = Array.from(map.values());
  if (customAgents.length > 0) {
    console.log(`Loaded ${customAgents.length} custom subagents`);
  }

  try {
    if (args.print) {
      await runHeadless({
        prompt: args.print,
        provider,
        toolRegistry: leaderRegistry,
        executor,
        permissions,
        systemPrompt,
        initialSession,
        autoApprove: args.yes,
        json: args.json,
      });
    } else {
      // If we have a TTY, start the Ink TUI, otherwise fall back to readline REPL
      if (process.stdout.isTTY && process.stdin.isTTY) {
        await startTui({
          provider,
          toolRegistry: leaderRegistry,
          executor,
          systemPrompt,
          initialSession,
          projectContextPath: projectContextPath ?? undefined,
          commands,
          startInPlanMode: args.plan,
          subagents,
          fastModel: config.fastModel,
          hooks,
          totalToolCount: toolRegistry.getAll().length,
        });
      } else {
        await startRepl({
          provider,
          toolRegistry: leaderRegistry,
          executor,
          systemPrompt,
          initialSession,
          projectContextPath: projectContextPath ?? undefined,
          commands,
          startInPlanMode: args.plan,
          subagents,
          fastModel: config.fastModel,
          hooks,
          totalToolCount: toolRegistry.getAll().length,
        });
      }
    }
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
