import React, { useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput, useStdout } from "ink";

import Spinner from "ink-spinner";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { OpenAIProvider } from "../provider/openai.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolExecutor } from "../tools/executor.js";
import type { MessageParam } from "../provider/types.js";
import { generateSessionId, listSessions, loadSession, saveSession, type Session } from "../sessions.js";
import type { CustomCommand } from "../commands.js";
import { filterRegistryForSubagent, listSubagents, type SubagentProfile } from "../agent/subagents.js";
import type { HooksConfig } from "../hooks.js";
import { runLifecycleHooks } from "../hooks.js";
import { runAgentLoop } from "../agent/loop.js";
import { DEFAULT_COMPACTION_CONFIG, compactMessages, shouldCompact } from "../agent/compaction.js";
import { PlanMode } from "../agent/plan_mode.js";
import { recordEvent } from "../telemetry.js";
import { createCompleter } from "../completion.js";
import { isMultilineStart, isMultilineEnd, shouldContinue, stripContinuation } from "../multiline.js";

interface AppProps {
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
}

interface HistoryEntry {
  type: "user" | "assistant" | "system" | "tool_call" | "tool_result";
  text: string;
  toolName?: string;
  isError?: boolean;
}

const COMMANDS = [
  "help", "save", "sessions", "load", "clear", "context", "plan", "execute", "compact", "cost", "stats",
  "init", "diff", "undo", "agent", "agents", "model", "doctor", "worktree", "trust", "exit", "quit",
];

function formatTokenCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export const App: React.FC<AppProps> = (props) => {
  const { exit } = useApp();
  const model = props.provider.getModel();
  const leaderTools = props.toolRegistry.getAll().length;
  const totalTools = props.totalToolCount ?? leaderTools;
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [currentToolName, setCurrentToolName] = useState("");
  const [tokens, setTokens] = useState({ input: 0, output: 0 });
  const [planActive, setPlanActive] = useState(Boolean(props.startInPlanMode));
  const [multiline, setMultiline] = useState<{ mode: "ticks" | "slash"; lines: string[] } | null>(null);
  const [pendingAgentPromptFor, setPendingAgentPromptFor] = useState<SubagentProfile | null>(null);
  const messagesRef = useRef<MessageParam[]>(props.initialSession?.messages ?? []);
  const sessionIdRef = useRef(props.initialSession?.id ?? generateSessionId());
  const sessionCreatedAtRef = useRef(props.initialSession?.createdAt ?? new Date().toISOString());
  const planModeRef = useRef(new PlanMode());
  const runningControllerRef = useRef<AbortController | null>(null);
  const ctrlCPressedAtRef = useRef<number | null>(null);
  const replStartCwdRef = useRef(process.cwd());
  const fastModelRef = useRef(props.fastModel);
  const reasoningModelRef = useRef(process.env["ATLAS_REASONING_MODEL"]);

  useEffect(() => {
    if (props.startInPlanMode) planModeRef.current.enter();
    runLifecycleHooks(props.hooks?.SessionStart ?? [], { ATLAS_SESSION_ID: sessionIdRef.current, ATLAS_CWD: process.cwd(), ATLAS_MODEL: model }).catch(() => {});
    recordEvent({ sessionId: sessionIdRef.current, timestamp: new Date().toISOString(), type: "session_start", data: { model, cwd: process.cwd() } }).catch(() => {});
    return () => {
      runLifecycleHooks(props.hooks?.SessionEnd ?? [], { ATLAS_SESSION_ID: sessionIdRef.current, ATLAS_CWD: process.cwd() }).catch(() => {});
      recordEvent({ sessionId: sessionIdRef.current, timestamp: new Date().toISOString(), type: "session_end", data: { messageCount: messagesRef.current.length } }).catch(() => {});
    };
  }, []);

  const allCommandNames = [...COMMANDS, ...(props.commands ?? []).map(c => c.name)];
  const subagentNames = ["atlas-swift", "atlas-forge", "atlas-deep", ...(props.subagents ?? []).map(s => s.name)];
  const completer = createCompleter({ commands: allCommandNames, subagentNames, cwd: process.cwd() });
  const suggestion = (() => {
    if (!input.startsWith("/") && !input.includes("@")) return null;
    const [hits] = completer(input);
    return hits.find(h => h !== input) ?? null;
  })();

  function addSystem(text: string) {
    setHistory(h => [...h, { type: "system", text }]);
  }

  function buildSession(): Session {
    return {
      id: sessionIdRef.current,
      createdAt: sessionCreatedAtRef.current,
      updatedAt: new Date().toISOString(),
      model: props.provider.getModel(),
      messageCount: messagesRef.current.length,
      messages: messagesRef.current,
    };
  }

  async function processAtMentions(value: string): Promise<string> {
    const atPattern = /@([\w./\-]+\.\w+)/g;
    let result = value;
    for (const match of [...value.matchAll(atPattern)]) {
      try {
        const filePath = path.resolve(process.cwd(), match[1]);
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.split("\n");
        const preview = lines.length > 200 ? lines.slice(0, 200).join("\n") + "\n... (truncated)" : content;
        result = result.replace(match[0], `\n\n<file path="${match[1]}">\n${preview}\n</file>\n`);
      } catch {}
    }
    return result;
  }

  async function runPrompt(prompt: string, options?: { registry?: ToolRegistry; provider?: OpenAIProvider; systemPrompt?: string }) {
    await runLifecycleHooks(props.hooks?.UserPromptSubmit ?? [], { ATLAS_PROMPT: prompt.slice(0, 500) });
    const processed = await processAtMentions(prompt);
    const content = planModeRef.current.isActive()
      ? "[PLAN MODE: You can only read and analyze. Do NOT suggest tool calls for write_file, edit_file, or bash. Design your approach and explain what changes you would make.]\n\n" + processed
      : processed;
    messagesRef.current.push({ role: "user", content });
    const controller = new AbortController();
    runningControllerRef.current = controller;
    setIsRunning(true);
    setStreamBuffer("");
    let streamedText = "";

    // Install tool callbacks on executor to capture tool call events when running in Ink mode
    try {
      (props.executor as any)._onToolCall = (name: string, summary: string) => {
        setHistory(h => [...h, { type: "tool_call", text: summary, toolName: name }]);
        setCurrentToolName(name);
      };
      (props.executor as any)._onToolResult = (name: string, resultStr: string, isError: boolean) => {
        setHistory(h => [...h, { type: "tool_result", text: resultStr, toolName: name, isError }]);
      };
    } catch (e) {}

    try {
      const result = await runAgentLoop({
        provider: options?.provider ?? props.provider,
        messages: messagesRef.current,
        toolRegistry: options?.registry ?? (planModeRef.current.isActive() ? planModeRef.current.filterRegistry(props.toolRegistry) : props.toolRegistry),
        executor: props.executor,
        systemPrompt: options?.systemPrompt ?? props.systemPrompt,
        abortSignal: controller.signal,
        onText: text => {
          streamedText += text;
          setStreamBuffer(b => b + text);
        },
      });
      setTokens(t => ({ input: t.input + result.inputTokens, output: t.output + result.outputTokens }));
      if (streamedText.trim()) {
        setHistory(h => [...h, { type: "assistant", text: streamedText }]);
      }
      setStreamBuffer("");
      await recordEvent({ sessionId: sessionIdRef.current, timestamp: new Date().toISOString(), type: "turn_complete", data: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, cachedTokens: (result as any).cachedTokens ?? 0 } });
      await runLifecycleHooks(props.hooks?.Stop ?? [], { ATLAS_SESSION_ID: sessionIdRef.current });
      if (shouldCompact(messagesRef.current, DEFAULT_COMPACTION_CONFIG)) {
        const before = messagesRef.current.length;
        messagesRef.current = await compactMessages({ messages: messagesRef.current, provider: props.provider, config: DEFAULT_COMPACTION_CONFIG });
        addSystem(`[Compacted: ${before} messages → ${messagesRef.current.length} messages]`);
      }
      saveSession(buildSession()).catch(() => {});
    } catch (err) {
      addSystem(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRunning(false);
      setCurrentToolName("");
      runningControllerRef.current = null;
      (props.executor as any)._onToolCall = undefined;
      (props.executor as any)._onToolResult = undefined;
    }
  }

  async function handleCommand(value: string): Promise<boolean> {
    if (value === "/save") {
      await saveSession(buildSession());
      addSystem(`Session saved: ${sessionIdRef.current}`);
      return true;
    }
    if (value === "/sessions") {
      const sessions = await listSessions();
      addSystem(sessions.length ? sessions.map(s => `  ${s.id}  ${s.updatedAt.slice(0, 10)}  ${s.messageCount} msgs`).join("\n") : "No saved sessions.");
      return true;
    }
    if (value.startsWith("/load ")) {
      const id = value.slice(6).trim();
      const session = await loadSession(id);
      if (!session) addSystem(`Session not found: ${id}`);
      else {
        messagesRef.current = session.messages;
        sessionIdRef.current = session.id;
        addSystem(`Loaded session ${id} (${session.messageCount} messages)`);
      }
      return true;
    }
    if (value === "/clear") {
      messagesRef.current = [];
      sessionIdRef.current = generateSessionId();
      addSystem("History cleared. Starting fresh session.");
      return true;
    }
    if (value === "/context") {
      addSystem(props.projectContextPath ? `Project context: ${props.projectContextPath}` : "No project context loaded");
      return true;
    }
    if (value === "/plan") {
      planModeRef.current.enter();
      setPlanActive(true);
      addSystem("[Plan mode ON — agent can only read, not modify]");
      return true;
    }
    if (value === "/execute" || value === "/do") {
      planModeRef.current.exit();
      setPlanActive(false);
      addSystem("[Plan mode OFF — agent can now modify files]");
      return true;
    }
    if (value === "/compact") {
      const before = messagesRef.current.length;
      messagesRef.current = await compactMessages({ messages: messagesRef.current, provider: props.provider, config: DEFAULT_COMPACTION_CONFIG });
      addSystem(`[Compacted: ${before} messages → ${messagesRef.current.length} messages]`);
      return true;
    }
    if (value === "/cost") {
      const inCost = (tokens.input / 1_000_000) * 1.5;
      const outCost = (tokens.output / 1_000_000) * 15.0;
      addSystem(`Token usage this session:\n  Input:  ${formatTokenCount(tokens.input)} tokens  (~$${inCost.toFixed(3)})\n  Output: ${formatTokenCount(tokens.output)} tokens  (~$${outCost.toFixed(3)})\n  Total:  ${formatTokenCount(tokens.input + tokens.output)} tokens  (~$${(inCost + outCost).toFixed(3)})`);
      return true;
    }
    if (value === "/stats" || value.startsWith("/stats ")) {
      const arg = value.slice(6).trim();
      const { getSessionStats, listAllSessionStats, formatStats } = await import("../telemetry.js");
      if (arg === "all") {
        const all = await listAllSessionStats();
        addSystem(all.length ? all.slice(0, 10).map(formatStats).join("\n\n") : "No telemetry data.");
      } else {
        const stats = await getSessionStats(arg || sessionIdRef.current);
        addSystem(stats ? formatStats(stats) : `No stats for session ${arg || "current"}.`);
      }
      return true;
    }
    if (value === "/help") {
      addSystem(`Commands:\n  /save /sessions /load <id> /clear /context\n  /plan /execute /compact /cost /stats [all|<id>] /init\n  /diff [path] /undo /worktree [list|create|enter|exit|remove]\n  /agent <name> [prompt] /agents /model [tier] [name] /doctor /trust [dir]\n\nMulti-line: type \`\`\` to start/end a block, or end a line with \\ to continue\n@file.ts injects file content into your prompt`);
      return true;
    }
    if (value === "/agents") {
      const agents = props.subagents ?? listSubagents();
      addSystem("Available agents:\n" + agents.map(a => `  ${a.name}  — ${a.description}`).join("\n"));
      return true;
    }
    if (value.startsWith("/agent ") || value === "/agent") {
      const rest = value.slice(7).trim();
      const spaceIdx = rest.indexOf(" ");
      const agentName = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
      const agentPrompt = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1).trim();
      const agents = props.subagents ?? listSubagents();
      const profile = agents.find(a => a.name === agentName);
      if (!profile) {
        addSystem(`Usage: /agent <name> <prompt>\nAvailable agents:\n${agents.map(a => `  ${a.name}  — ${a.description}`).join("\n")}`);
      } else if (!agentPrompt) {
        // prompt the user for the agent prompt via the TUI: set pendingAgentPromptFor
        setPendingAgentPromptFor(profile);
      } else {
        await runPrompt(agentPrompt, { registry: filterRegistryForSubagent(props.toolRegistry, profile), provider: profile.model ? props.provider.withModel(profile.model) : props.fastModel ? props.provider.withModel(props.fastModel) : props.provider, systemPrompt: profile.systemPrompt });
      }
      return true;
    }
    if (value === "/model" || value.startsWith("/model ")) {
      const arg = value.slice(6).trim();
      if (!arg) addSystem(`Current models:\n  main:      ${props.provider.getModel()}     (leader)\n  fast:      ${fastModelRef.current ?? "(uses main)"}     (atlas-swift, atlas-forge)\n  reasoning: ${reasoningModelRef.current ?? "(uses main)"}     (atlas-deep)`);
      else {
        const parts = arg.split(/\s+/);
        const tier = parts[0] === "fast" || parts[0] === "reasoning" || parts[0] === "main" ? parts[0] : "main";
        const newModel = tier === "main" && parts[0] !== "main" ? arg : parts.slice(1).join(" ").trim();
        if (!newModel) { addSystem(`Usage: /model ${tier} <name>`); return true; }
        if (tier === "main") Object.assign(props.provider, props.provider.withModel(newModel));
        else if (tier === "fast") { fastModelRef.current = newModel; process.env["ATLAS_FAST_MODEL"] = newModel; }
        else { reasoningModelRef.current = newModel; process.env["ATLAS_REASONING_MODEL"] = newModel; }
        addSystem(`${tier} model: ${newModel}`);
      }
      return true;
    }
    if (value === "/init" || value === "/init --force") {
      await runPrompt("Scan this project and generate an ATLAS.md file. Include project overview, directory structure, key files, build/run commands, and common tasks. Keep it under 150 lines, concise and useful as AI context.");
      return true;
    }
    if (value === "/diff" || value.startsWith("/diff ")) {
      const arg = value.slice(5).trim();
      const args = ["diff", "--color=always", ...(arg ? ["--", arg] : [])];
      const output = await new Promise<string>(resolve => {
        const child = spawn("git", args, { cwd: process.cwd() });
        let out = "";
        child.stdout.on("data", d => { out += d.toString(); });
        child.stderr.on("data", d => { out += d.toString(); });
        child.on("close", () => resolve(out));
      });
      addSystem(output.trim() || "No changes.");
      return true;
    }
    if (value === "/undo") {
      const { popUndo } = await import("../undo.js");
      const entry = popUndo();
      if (!entry) addSystem("Nothing to undo.");
      else {
        if (entry.previousContent === null) await fs.unlink(entry.path);
        else await fs.writeFile(entry.path, entry.previousContent, "utf-8");
        addSystem(entry.previousContent === null ? `Undo: deleted ${entry.path}` : `Undo: restored ${entry.path}`);
      }
      return true;
    }
    if (value.startsWith("/trust")) {
      const dir = value.slice(6).trim() || ".";
      const resolved = path.resolve(process.cwd(), dir);
      const trustedDirs = (props.executor as any).ctx?._trustedDirs ?? [];
      if (!trustedDirs.includes(resolved)) trustedDirs.push(resolved);
      if ((props.executor as any).ctx) (props.executor as any).ctx._trustedDirs = trustedDirs;
      addSystem(`Trusted: ${resolved} (no permission prompts for files in this directory)`);
      return true;
    }
    if (value === "/doctor") {
      await runPrompt("Run diagnostics for this atlas-agent project and report any setup issues.");
      return true;
    }
    if (value === "/worktree" || value.startsWith("/worktree ")) {
      const { listWorktrees, createWorktree, removeWorktree, hasUncommittedChanges } = await import("../worktree.js");
      const parts = value.split(/\s+/);
      const subcmd = parts[1] ?? "list";
      if (subcmd === "list") {
        const wts = await listWorktrees(replStartCwdRef.current);
        addSystem(wts.length ? wts.map(wt => `  ${wt.branch}  ${wt.path}`).join("\n") : "No worktrees.");
        return true;
      }
      if (subcmd === "create") {
        const name = parts[2];
        if (!name) addSystem("Usage: /worktree create <name>");
        else {
          const result = await createWorktree(replStartCwdRef.current, name);
          addSystem(result.error ? `Error: ${result.error}` : `Created worktree: ${result.path}\nBranch: atlas/${name}\nUse /worktree enter ${name} to switch into it`);
        }
        return true;
      }
      if (subcmd === "enter") {
        const name = parts[2];
        if (!name) addSystem("Usage: /worktree enter <name>");
        else {
          const fsSync = await import("node:fs");
          const wtPath = path.join(replStartCwdRef.current, ".atlas", "worktrees", name);
          if (!fsSync.existsSync(wtPath)) addSystem(`Worktree not found: ${name}`);
          else { process.chdir(wtPath); addSystem(`Switched to worktree: ${wtPath}`); }
        }
        return true;
      }
      if (subcmd === "exit") {
        if (process.cwd() === replStartCwdRef.current) addSystem("Not currently in a worktree.");
        else { process.chdir(replStartCwdRef.current); addSystem(`Returned to: ${replStartCwdRef.current}`); }
        return true;
      }
      if (subcmd === "remove" || subcmd === "rm") {
        const name = parts[2];
        if (!name) addSystem("Usage: /worktree remove <name>");
        else {
          const wtPath = path.join(replStartCwdRef.current, ".atlas", "worktrees", name);
          const force = parts[3] === "--force";
          if (await hasUncommittedChanges(wtPath) && !force) addSystem("Worktree has uncommitted changes. Add --force to remove anyway.");
          else {
            const result = await removeWorktree(replStartCwdRef.current, name, force);
            addSystem(result.error ? `Error: ${result.error}` : `Removed worktree: ${name}`);
          }
        }
        return true;
      }
      addSystem("Usage: /worktree [list|create <name>|enter <name>|exit|remove <name>]");
      return true;
    }
    const withoutSlash = value.slice(1);
    const spaceIdx = withoutSlash.indexOf(" ");
    const cmdName = spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx);
    const cmdArgs = spaceIdx === -1 ? "" : withoutSlash.slice(spaceIdx + 1).trim();
    const matched = props.commands?.find(c => c.name === cmdName);
    if (matched) {
      await runPrompt(matched.promptBody + (cmdArgs ? `\n\nUser argument: ${cmdArgs}` : ""));
      return true;
    }
    return false;
  }

  const handleSubmit = async (value: string) => {
    if (!value.trim()) return;
    const trimmed = value.trim();
    setInput("");

    if (multiline) {
      if ((multiline.mode === "ticks" && isMultilineEnd(trimmed)) || (multiline.mode === "slash" && !shouldContinue(trimmed))) {
        const lines = multiline.mode === "slash" ? [...multiline.lines, trimmed] : multiline.lines;
        setMultiline(null);
        await handleSubmit(lines.join("\n"));
      } else {
        setMultiline({ mode: multiline.mode, lines: [...multiline.lines, multiline.mode === "slash" ? stripContinuation(trimmed) : value] });
      }
      return;
    }

    if (isMultilineStart(trimmed)) {
      setMultiline({ mode: "ticks", lines: [] });
      return;
    }
    if (shouldContinue(trimmed)) {
      setMultiline({ mode: "slash", lines: [stripContinuation(trimmed)] });
      return;
    }
    if (trimmed === "exit" || trimmed === "quit" || trimmed === "/exit" || trimmed === "/quit") {
      exit();
      return;
    }

    if (pendingAgentPromptFor) {
      setHistory(h => [...h, { type: "user", text: trimmed }]);
      const profile = pendingAgentPromptFor;
      setPendingAgentPromptFor(null);
      await runPrompt(trimmed, {
        registry: filterRegistryForSubagent(props.toolRegistry, profile),
        provider: profile.model ? props.provider.withModel(profile.model) : fastModelRef.current ? props.provider.withModel(fastModelRef.current) : props.provider,
        systemPrompt: profile.systemPrompt,
      });
      return;
    }

    setHistory(h => [...h, { type: "user", text: trimmed }]);
    if (trimmed.startsWith("/") && await handleCommand(trimmed)) return;
    await runPrompt(trimmed);
  };

  useInput((inputChar, key) => {
    // Ctrl+C handling
    if (key.ctrl && inputChar === "c") {
      if (isRunning) {
        runningControllerRef.current?.abort();
        addSystem("[Interrupted]");
        return;
      }
      const now = Date.now();
      if (ctrlCPressedAtRef.current && now - ctrlCPressedAtRef.current < 3000) exit();
      else {
        ctrlCPressedAtRef.current = now;
        addSystem("(Press Ctrl+C again to exit)");
      }
      return;
    }

    if (isRunning) return;

    // Tab → accept suggestion
    if (key.tab) {
      if (suggestion) setInput(suggestion);
      return;
    }

    // Enter → submit
    if (key.return) {
      const value = input;
      setInput("");
      if (value.trim()) handleSubmit(value);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      setInput((s) => s.slice(0, -1));
      return;
    }

    // Skip other special keys
    if (key.escape || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.pageDown || key.pageUp || key.meta) return;

    // Regular character — append
    if (inputChar && !key.ctrl) {
      setInput((s) => s + inputChar);
    }
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan"> █████╗ ████████╗██╗      █████╗ ███████╗</Text>
        <Text bold color="cyan">██╔══██╗╚══██╔══╝██║     ██╔══██╗██╔════╝</Text>
        <Text bold color="cyan">███████║   ██║   ██║     ███████║███████╗</Text>
        <Text bold color="cyan">██╔══██║   ██║   ██║     ██╔══██║╚════██║</Text>
        <Text bold color="cyan">██║  ██║   ██║   ███████╗██║  ██║███████║</Text>
        <Text bold color="cyan">╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚══════╝</Text>
        <Text color="gray">  AI Coding Assistant • v1.0.0 • {leaderTools} leader / {totalTools} total tools</Text>
        <Text color="gray">  Model: {model}</Text>
        <Text color="gray">  Type /help for commands, "exit" to quit</Text>
      </Box>
      <Static items={history}>
        {(entry, index) => (
          <Box key={index} flexDirection="column" marginBottom={1}>
            {entry.type === "user" && (
              <Box>
                <Text color="cyan" bold>{"> "}</Text>
                <Text bold>{entry.text}</Text>
              </Box>
            )}
            {entry.type === "assistant" && (
              <Box paddingLeft={0}>
                <Text>{entry.text}</Text>
              </Box>
            )}
            {entry.type === "tool_call" && (
              <Box>
                <Text color="gray" dimColor>{"  ↳ "}</Text>
                <Text color="cyan">{entry.toolName ?? "tool"}</Text>
                {entry.text && <Text color="gray" dimColor>{": " + entry.text}</Text>}
              </Box>
            )}
            {entry.type === "tool_result" && (
              <Box paddingLeft={4}>
                <Text color={entry.isError ? "red" : "gray"} dimColor={!entry.isError}>
                  {entry.text.slice(0, 200)}{entry.text.length > 200 ? "…" : ""}
                </Text>
              </Box>
            )}
            {entry.type === "system" && (
              <Text color="yellow" dimColor>{entry.text}</Text>
            )}
          </Box>
        )}
      </Static>
      {streamBuffer && (
        <Box flexDirection="column">
          <Text>{streamBuffer}</Text>
        </Box>
      )}
      {isRunning && (
        <Box>
          <Text color="yellow"><Spinner /></Text>
          <Text color="gray"> {currentToolName ? `${currentToolName}…` : "thinking…"}</Text>
        </Box>
      )}
      {!isRunning && (
        <Box flexDirection="column" width={80}>
          <Box borderStyle="round" borderColor="cyan" paddingX={1}>
            <Text color="cyan" bold>{planActive ? "[plan] " : multiline ? "... " : "> "}</Text>
            <Text>{input}</Text>
            <Text color="gray">█</Text>
            {suggestion && <Text color="gray" dimColor>{suggestion.slice(input.length)}</Text>}
          </Box>
          {input.startsWith("/") && input.length >= 1 && (
            <Box flexDirection="column" paddingX={2}>
              {(() => {
                const allCmds = [
                  "/help","/save","/sessions","/load","/clear","/context",
                  "/plan","/execute","/compact","/cost","/stats","/init",
                  "/diff","/undo","/agent","/agents","/model","/doctor",
                  "/worktree","/trust",
                  ...(props.commands ?? []).map(c => `/${c.name}`),
                ];
                return allCmds.filter(c => c.startsWith(input)).slice(0, 6).map((m, i) => (
                  <Text key={m} color={i === 0 ? "cyan" : "gray"} dimColor={i !== 0}>
                    {i === 0 ? "› " : "  "}{m}
                  </Text>
                ));
              })()}
            </Box>
          )}
          <Text color="gray" dimColor>  Tab · complete  ↵ · send  Ctrl+C · exit</Text>
        </Box>
      )}
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} width={80}>
        <Text color="gray">{tokens.input + tokens.output > 0 ? ` ${formatTokenCount(tokens.input)}↑ ${formatTokenCount(tokens.output)}↓ tokens ` : ""}{props.provider.getModel() && ` • ${props.provider.getModel()}`}</Text>
      </Box>
    </Box>
  );
};
