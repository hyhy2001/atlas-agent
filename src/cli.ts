import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { AnthropicProvider } from "./provider/anthropic.js";
import { McpClient } from "./mcp/client.js";
import { ToolRegistry } from "./tools/registry.js";
import { ToolExecutor } from "./tools/executor.js";
import { builtinTools } from "./tools/builtin/index.js";
import { PermissionSession } from "./permissions/session.js";
import { startRepl } from "./repl.js";
import { runHeadless } from "./headless.js";
import { DEFAULT_SYSTEM_PROMPT } from "./agent/system_prompt.js";
import { listSessions, loadSession } from "./sessions.js";
import { loadProjectContext, findProjectContextPath } from "./agent/context_loader.js";
import { loadCommands } from "./commands.js";
import { loadCustomSubagents, BUILTIN_SUBAGENTS } from "./agent/subagents.js";
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

  const apiKey = config.authToken || process.env["ATLAS_API_KEY"] || "";
  if (!apiKey) {
    console.error(
      "Error: No API key found. Set ATLAS_AUTH_TOKEN or ATLAS_API_KEY environment variable,\n" +
        "or add authToken to ~/.config/atlas-agent/config.json"
    );
    process.exit(1);
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

  // Load hooks config (global + project)
  const { loadHooks } = await import("./hooks.js");
  const hooks = await loadHooks(process.cwd());

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
        toolRegistry,
        executor,
        permissions,
        systemPrompt,
        initialSession,
        autoApprove: args.yes,
        json: args.json,
      });
    } else {
      await startRepl({
        provider,
        toolRegistry,
        executor,
        systemPrompt,
        initialSession,
        projectContextPath: projectContextPath ?? undefined,
        commands,
        startInPlanMode: args.plan,
        subagents,
        subagentModel: config.subagentModel,
        hooks,
      });
    }
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
