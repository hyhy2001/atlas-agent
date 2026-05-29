import React, { useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput, useStdout } from "ink";

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
  bannerText?: string;
}

interface HistoryEntry {
  type: "banner" | "user" | "assistant" | "system" | "tool_call" | "tool_result" | "tool_result_full" | "subagent_done";
  text: string;
  fullText?: string;
  toolName?: string;
  isError?: boolean;
  nested?: boolean;
}

const STATUS_VERBS = [
  "Working", "Thinking", "Analyzing", "Planning", "Searching",
  "Reasoning", "Processing", "Investigating", "Synthesizing", "Exploring",
];

const TIPS = [
  "Use /plan to enter plan mode before making changes",
  "Use /compact to summarize the conversation and free up context",
  "Use /diff to see all changes made this session",
  "Use /agent to switch between subagent profiles",
  "Use /cost to see token usage and estimated cost",
  "Ctrl+O expands truncated tool output",
  "Use /clear to start a fresh session",
];

const COMMANDS = [
  "help", "save", "sessions", "load", "resume", "clear", "context", "plan", "execute", "compact", "cost", "stats",
  "init", "diff", "undo", "agent", "agents", "model", "doctor", "worktree", "trust", "exit", "quit",
];

interface OverlayItem {
  label: string;
  sublabel?: string;
  value: string;
}

type PermMode = "ask" | "auto" | "plan";
const PERM_MODES: PermMode[] = ["ask", "auto", "plan"];
const PERM_MODE_LABELS: Record<PermMode, string> = {
  ask: "ask",
  auto: "auto-approve",
  plan: "plan only",
};

interface AgentTask {
  id: string;
  agent: string;
  status: "running" | "done" | "error";
  startedAt: number;
  durationMs?: number;
  toolUses?: number;
  tokens?: number;
}

function formatTokenCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const secs = Math.floor((now - then) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function formatToolName(name: string): string {
  const map: Record<string, string> = {
    bash: "Bash",
    read_file: "Read",
    write_file: "Write",
    edit_file: "Edit",
    grep: "Search",
    glob: "Find",
    list_directory: "List",
    web_fetch: "Fetch",
    git_status: "Git",
    git_diff: "Git",
    git_log: "Git",
    git_commit: "Commit",
    delegate: "Delegate",
    delegate_parallel: "Delegate",
    apply_patch: "Patch",
    read_many_files: "Read",
    todo_write: "Todo",
    todo_read: "Todo",
    memory_save: "Memory",
    memory_read: "Memory",
    memory_append: "Memory",
    analyze_log: "Analyze",
  };
  return map[name] ?? name.split("_").map(w => w[0].toUpperCase() + w.slice(1)).join("");
}

function formatToolResult(text: string, maxLines = 5): { preview: string; hidden: number } {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return { preview: text, hidden: 0 };
  return {
    preview: lines.slice(0, maxLines).join("\n"),
    hidden: lines.length - maxLines,
  };
}

const DIFF_MARKER = "__ATLAS_DIFF__";

function isDiffOutput(text: string): boolean {
  return text.startsWith(DIFF_MARKER);
}

interface DiffLine {
  type: "header" | "hunk" | "add" | "remove" | "context" | "ellipsis";
  lineNum?: number;
  text: string;
}

function parseDiffOutput(text: string): { header: string; lines: DiffLine[] } {
  const body = text.slice(DIFF_MARKER.length);
  const [header, ...rest] = body.split("\n");
  const lines: DiffLine[] = [];
  for (const raw of rest) {
    if (raw.startsWith("@@HUNK@@")) {
      lines.push({ type: "hunk", text: raw.slice("@@HUNK@@".length) });
    } else if (raw.startsWith("…@@")) {
      lines.push({ type: "ellipsis", text: raw.slice(3) });
    } else {
      const sep = raw.indexOf("@@");
      if (sep === -1) continue;
      const marker = raw[0];
      const lineNum = parseInt(raw.slice(1, sep)) || 0;
      const content = raw.slice(sep + 2);
      const type = marker === "+" ? "add" : marker === "-" ? "remove" : "context";
      lines.push({ type, lineNum, text: content });
    }
  }
  return { header, lines };
}

export const App: React.FC<AppProps> = (props) => {
  const { exit } = useApp();
  const model = props.provider.getModel();
  const leaderTools = props.toolRegistry.getAll().length;
  const totalTools = props.totalToolCount ?? leaderTools;
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>(
    props.bannerText ? [{ type: "banner", text: props.bannerText }] : []
  );
  const [isRunning, setIsRunning] = useState(false);
  const [spinFrame, setSpinFrame] = useState(0);
  const SPIN_FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  const [liveTail, setLiveTail] = useState("");
  const [currentToolName, setCurrentToolName] = useState("");
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [statusVerb, setStatusVerb] = useState("Working");
  const [tip, setTip] = useState<string | null>(null);
  const [termCols, setTermCols] = useState(process.stdout.columns ?? 80);

  useEffect(() => {
    const onResize = () => setTermCols(process.stdout.columns ?? 80);
    process.stdout.on("resize", onResize);
    return () => { process.stdout.off("resize", onResize); };
  }, []);

  const fullWidth = termCols - 2;
  const overlayWidth = Math.max(40, termCols - 4);
  const [tokens, setTokens] = useState({ input: 0, output: 0 });
  const [liveTokens, setLiveTokens] = useState(0);
  const [planActive, setPlanActive] = useState(Boolean(props.startInPlanMode));
  const [permMode, setPermMode] = useState<PermMode>("ask");
  const [gitBranch, setGitBranch] = useState<string>("");
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);
  const [multiline, setMultiline] = useState<{ mode: "ticks" | "slash"; lines: string[] } | null>(null);
  const [pendingAgentPromptFor, setPendingAgentPromptFor] = useState<SubagentProfile | null>(null);
  const [questionOverlay, setQuestionOverlay] = useState<{
    question: string;
    items: OverlayItem[];
    selectedIndex: number;
    resolve: (answer: string) => void;
  } | null>(null);
  const messagesRef = useRef<MessageParam[]>(props.initialSession?.messages ?? []);
  const sessionIdRef = useRef(props.initialSession?.id ?? generateSessionId());
  const sessionCreatedAtRef = useRef(props.initialSession?.createdAt ?? new Date().toISOString());
  const planModeRef = useRef(new PlanMode());
  const runningControllerRef = useRef<AbortController | null>(null);
  const ctrlCPressedAtRef = useRef<number | null>(null);
  const replStartCwdRef = useRef(process.cwd());
  const fastModelRef = useRef(props.fastModel);
  const reasoningModelRef = useRef(process.env["ATLAS_REASONING_MODEL"]);
  const startedAtRef = useRef<number | null>(null);
  const pendingCommitRef = useRef("");
  const agentTaskIdRef = useRef(0);

  useEffect(() => {
    import("node:child_process").then(({ execSync }) => {
      try {
        const branch = execSync("git branch --show-current 2>/dev/null", { encoding: "utf8" }).trim();
        setGitBranch(branch);
      } catch {
        setGitBranch("");
      }
    });
  }, []);

  useEffect(() => {
    if (!isRunning) { setElapsedSecs(0); return; }
    startedAtRef.current = Date.now();
    setElapsedSecs(0);
    const id = setInterval(() => {
      setElapsedSecs(Math.floor((Date.now() - (startedAtRef.current ?? Date.now())) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning) { setSpinFrame(0); return; }
    const id = setInterval(() => setSpinFrame(f => (f + 1) % 10), 80);
    return () => clearInterval(id);
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning) { setStatusVerb("Working"); return; }
    const id = setInterval(() => {
      setStatusVerb(STATUS_VERBS[Math.floor(Math.random() * STATUS_VERBS.length)]);
    }, 10000);
    return () => clearInterval(id);
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning) { setTip(null); return; }
    const id = setTimeout(() => {
      setTip(TIPS[Math.floor(Math.random() * TIPS.length)]);
    }, 15000);
    return () => clearTimeout(id);
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      const text = pendingCommitRef.current;
      if (text) {
        pendingCommitRef.current = "";
        setHistory(h => [...h, { type: "assistant", text: text.replace(/\n$/, "") }]);
      }
    }, 100);
    return () => {
      clearInterval(id);
      const text = pendingCommitRef.current;
      if (text) {
        pendingCommitRef.current = "";
        setHistory(h => [...h, { type: "assistant", text: text.replace(/\n$/, "") }]);
      }
    };
  }, [isRunning]);

  useEffect(() => {
    if (props.startInPlanMode) planModeRef.current.enter();
    runLifecycleHooks(props.hooks?.SessionStart ?? [], { ATLAS_SESSION_ID: sessionIdRef.current, ATLAS_CWD: process.cwd(), ATLAS_MODEL: model }).catch(() => {});
    recordEvent({ sessionId: sessionIdRef.current, timestamp: new Date().toISOString(), type: "session_start", data: { model, cwd: process.cwd() } }).catch(() => {});
    return () => {
      runLifecycleHooks(props.hooks?.SessionEnd ?? [], { ATLAS_SESSION_ID: sessionIdRef.current, ATLAS_CWD: process.cwd() }).catch(() => {});
      recordEvent({ sessionId: sessionIdRef.current, timestamp: new Date().toISOString(), type: "session_end", data: { messageCount: messagesRef.current.length } }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    (props.executor as any)._askUser = (question: string, options: string[]) => {
      return new Promise<string>((resolve) => {
        setQuestionOverlay({
          question,
          items: options.map(o => ({ label: o, value: o })),
          selectedIndex: 0,
          resolve,
        });
      });
    };
    return () => {
      (props.executor as any)._askUser = undefined;
    };
  }, [props.executor]);

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
    setLiveTail("");
    setLiveTokens(0);
    setAgentTasks([]);
    let rawSource = "";
    let committedLen = 0;

    // Install tool callbacks on executor to capture tool call events when running in Ink mode
    try {
      (props.executor as any)._onToolCall = (name: string, summary: string, nested = false) => {
        setHistory(h => [...h, { type: "tool_call", text: summary, toolName: name, nested }]);
        if (!nested) setCurrentToolName(name);
      };
      (props.executor as any)._onToolResult = (name: string, resultStr: string, isError: boolean, nested = false) => {
        setHistory(h => [...h, { type: "tool_result", text: resultStr, fullText: resultStr, toolName: name, isError, nested }]);
      };
      (props.executor as any)._onSubagentDone = (agentName: string, toolUses: number, tokens: number, durationMs: number) => {
        const seconds = Math.floor(durationMs / 1000);
        const timeStr = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
        const tokenStr = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
        const text = `Done (${toolUses} tool ${toolUses === 1 ? "use" : "uses"} · ${tokenStr} tokens · ${timeStr})`;
        setHistory(h => [...h, { type: "subagent_done", text, toolName: agentName }]);
        setAgentTasks(tasks => tasks.map(t =>
          t.agent === agentName && t.status === "running"
            ? { ...t, status: "done", durationMs, toolUses, tokens }
            : t
        ));
      };
      (props.executor as any)._onDelegateStart = (agentName: string): string => {
        const id = String(++agentTaskIdRef.current);
        setAgentTasks(tasks => [...tasks, {
          id,
          agent: agentName,
          status: "running",
          startedAt: Date.now(),
        }]);
        return id;
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
          rawSource += text;
          const lastNl = rawSource.lastIndexOf("\n");
          if (lastNl >= committedLen) {
            const newComplete = rawSource.slice(committedLen, lastNl + 1);
            committedLen = lastNl + 1;
            // Batch into pending commit — flushed every 100ms by useEffect
            pendingCommitRef.current += newComplete;
          }
          setLiveTail(rawSource.slice(committedLen));
        },
        onTokens: (deltaTokens: number) => {
          setLiveTokens(t => t + deltaTokens);
        },
      });
      setTokens(t => ({ input: t.input + result.inputTokens, output: t.output + result.outputTokens }));
      // Flush any batched complete lines first, then commit remaining tail
      const pending = pendingCommitRef.current;
      pendingCommitRef.current = "";
      const tail = rawSource.slice(committedLen);
      const finalText = pending + tail;
      if (finalText.trim()) {
        setHistory(h => [...h, { type: "assistant", text: finalText.replace(/\n$/, "") }]);
      }
      setLiveTail("");
      await recordEvent({ sessionId: sessionIdRef.current, timestamp: new Date().toISOString(), type: "turn_complete", data: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, cachedTokens: (result as any).cachedTokens ?? 0 } });
      await runLifecycleHooks(props.hooks?.Stop ?? [], { ATLAS_SESSION_ID: sessionIdRef.current });
      if (shouldCompact(messagesRef.current, DEFAULT_COMPACTION_CONFIG)) {
        const before = messagesRef.current.length;
        const result = await compactMessages({ messages: messagesRef.current, provider: props.provider, config: DEFAULT_COMPACTION_CONFIG });
        messagesRef.current = result.messages;
        addSystem(`[Compacted: ${before} → ${result.messages.length} messages]\n\n${result.summary}`);
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
      (props.executor as any)._onSubagentDone = undefined;
      (props.executor as any)._onDelegateStart = undefined;
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
    if (value === "/resume") {
      const sessions = await listSessions();
      if (sessions.length === 0) {
        addSystem("No saved sessions to resume.");
        return true;
      }
      const items = sessions.slice(0, 10).map(s => {
        const date = s.updatedAt.slice(0, 10);
        const time = s.updatedAt.slice(11, 16);
        const ago = formatTimeAgo(s.updatedAt);
        return {
          label: `${s.id}`,
          sublabel: `${date} ${time} (${ago}) · ${s.messageCount} messages`,
          value: s.id,
        };
      });
      const chosenId = await new Promise<string>((resolve) => {
        setQuestionOverlay({
          question: "Resume which session?",
          items,
          selectedIndex: 0,
          resolve,
        });
      });
      if (!chosenId) {
        addSystem("Resume cancelled.");
        return true;
      }
      const session = await loadSession(chosenId);
      if (!session) {
        addSystem(`Session not found: ${chosenId}`);
        return true;
      }
      messagesRef.current = session.messages;
      sessionIdRef.current = session.id;
      addSystem(`Resumed session ${chosenId} (${session.messageCount} messages)`);
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
      if (before === 0) {
        addSystem("Nothing to compact.");
        return true;
      }
      addSystem("Compacting conversation...");
      try {
        const result = await compactMessages({
          messages: messagesRef.current,
          provider: props.provider,
          config: DEFAULT_COMPACTION_CONFIG,
        });
        messagesRef.current = result.messages;
        addSystem(`Compacted ${before} → ${result.messages.length} messages.\n\n## Summary\n\n${result.summary}`);
      } catch (err) {
        addSystem(`Compact failed: ${err instanceof Error ? err.message : String(err)}`);
      }
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
      addSystem(`Commands:\n  /save /sessions /load <id> /resume /clear /context\n  /plan /execute /compact /cost /stats [all|<id>] /init\n  /diff [path] /undo /worktree [list|create|enter|exit|remove]\n  /agent <name> [prompt] /agents /model [tier] [name] /doctor /trust [dir]\n\nMulti-line: type \`\`\` to start/end a block, or end a line with \\ to continue\n@file.ts injects file content into your prompt`);
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
      if (!arg) {
        const mainModel = props.provider.getModel();
        const fastModel = fastModelRef.current ?? "(uses main)";
        const reasoningModel = reasoningModelRef.current ?? "(uses main)";
        const chosen = await new Promise<string>((resolve) => {
          setQuestionOverlay({
            question: "Which model tier?",
            items: [
              { label: "main", sublabel: `${mainModel} — leader model`, value: "main" },
              { label: "fast", sublabel: `${fastModel} — atlas-swift, atlas-forge`, value: "fast" },
              { label: "reasoning", sublabel: `${reasoningModel} — atlas-deep`, value: "reasoning" },
              { label: "show all", sublabel: "display current configuration", value: "show" },
            ],
            selectedIndex: 0,
            resolve,
          });
        });
        if (!chosen || chosen === "show") {
          addSystem(`Models:\n  main:      ${mainModel}\n  fast:      ${fastModel}\n  reasoning: ${reasoningModel}`);
          return true;
        }
        addSystem(`Type the new model name for "${chosen}" tier.\nUsage: /model ${chosen} <model-name>`);
        return true;
      }
      const parts = arg.split(/\s+/);
      const tier = parts[0] === "fast" || parts[0] === "reasoning" || parts[0] === "main" ? parts[0] : "main";
      const newModel = tier === "main" && parts[0] !== "main" ? arg : parts.slice(1).join(" ").trim();
      if (!newModel) { addSystem(`Usage: /model ${tier} <name>`); return true; }
      if (tier === "main") Object.assign(props.provider, props.provider.withModel(newModel));
      else if (tier === "fast") { fastModelRef.current = newModel; process.env["ATLAS_FAST_MODEL"] = newModel; }
      else { reasoningModelRef.current = newModel; process.env["ATLAS_REASONING_MODEL"] = newModel; }
      addSystem(`${tier} model: ${newModel}`);
      return true;
    }
    if (value === "/init" || value === "/init --force") {
      const force = value.includes("--force");
      // Check if ATLAS.md already exists
      try {
        await fs.access(path.join(process.cwd(), "ATLAS.md"));
        if (!force) {
          addSystem("ATLAS.md already exists. Use /init --force to regenerate.");
          return true;
        }
      } catch {}

      addSystem("Scanning project structure...");

      // Gather project info before running prompt
      let projectInfo = "";
      try {
        const { execSync } = await import("node:child_process");
        const tree = execSync(
          "find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/deps/*' -not -path '*/.atlas/sessions/*' -not -path '*/.atlas/cache/*' -not -path '*/.atlas/telemetry/*' | sort 2>/dev/null",
          { encoding: "utf8", cwd: process.cwd() }
        ).slice(0, 3000);
        projectInfo += `\nProject file tree:\n${tree}`;
      } catch {}

      try {
        const pkg = await fs.readFile(path.join(process.cwd(), "package.json"), "utf-8");
        const parsed = JSON.parse(pkg);
        projectInfo += `\n\npackage.json: name=${parsed.name}, version=${parsed.version}`;
        if (parsed.scripts) projectInfo += `\nScripts: ${Object.keys(parsed.scripts).join(", ")}`;
        if (parsed.dependencies) projectInfo += `\nDependencies: ${Object.keys(parsed.dependencies).slice(0, 15).join(", ")}`;
      } catch {}

      await runPrompt(`Generate an ATLAS.md file for this project. Here is the scanned project context:
${projectInfo}

Create a concise ATLAS.md (under 150 lines) with these sections:
1. **Project overview** — what this project does (1-2 sentences)
2. **Key directories** — what each important directory contains
3. **Build/run/test commands** — exact commands to build, run, test
4. **Architecture** — main components and how they connect
5. **Common tasks** — how to add features, run tests, debug
6. **Conventions** — important patterns, constraints, or rules

Write the file using write_file tool to ATLAS.md in the current directory.`);
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
    if (questionOverlay) {
      if (key.upArrow) {
        setQuestionOverlay(o => o ? { ...o, selectedIndex: Math.max(0, o.selectedIndex - 1) } : o);
        return;
      }
      if (key.downArrow) {
        setQuestionOverlay(o => o ? { ...o, selectedIndex: Math.min(o.items.length - 1, o.selectedIndex + 1) } : o);
        return;
      }
      if (key.return) {
        const overlay = questionOverlay;
        setQuestionOverlay(null);
        overlay.resolve(overlay.items[overlay.selectedIndex].value);
        return;
      }
      if (key.escape) {
        const overlay = questionOverlay;
        setQuestionOverlay(null);
        overlay.resolve("");
        return;
      }
      if (inputChar >= "1" && inputChar <= "4") {
        const idx = parseInt(inputChar) - 1;
        if (idx < questionOverlay.items.length) {
          const overlay = questionOverlay;
          setQuestionOverlay(null);
          overlay.resolve(overlay.items[idx].value);
          return;
        }
      }
      return;
    }

    // Ctrl+O: expand most recent truncated tool result
    if (key.ctrl && inputChar === "o") {
      setHistory(h => {
        // Find the most recent tool_result entry that has hidden content
        for (let i = h.length - 1; i >= 0; i--) {
          const entry = h[i];
          if (entry.type === "tool_result" && entry.fullText) {
            const lineCount = entry.fullText.split("\n").length;
            if (lineCount > 5) {
              // Append a tool_result_full entry showing the complete output
              return [...h, {
                type: "tool_result_full",
                text: entry.fullText,
                toolName: entry.toolName,
                isError: entry.isError,
                nested: entry.nested,
              }];
            }
            return h; // already short, nothing to expand
          }
        }
        return h;
      });
      return;
    }

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

    // Shift+Tab: cycle permission mode
    if (key.shift && key.tab) {
      setPermMode(m => {
        const idx = PERM_MODES.indexOf(m);
        const next = PERM_MODES[(idx + 1) % PERM_MODES.length];
        if (next === "auto") {
          (props.executor as any)._autoApprove = true;
        } else {
          (props.executor as any)._autoApprove = false;
        }
        if (next === "plan") {
          planModeRef.current.enter();
          setPlanActive(true);
        } else if (m === "plan") {
          planModeRef.current.exit();
          setPlanActive(false);
        }
        return next;
      });
      return;
    }

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
      <Static items={history}>
        {(entry, index) => (
          <Box key={index} flexDirection="column" marginBottom={entry.type === "user" || entry.type === "banner" ? 1 : 0}>
            {entry.type === "banner" && (
              <Text>{entry.text}</Text>
            )}
            {entry.type === "user" && (
              <Box marginTop={1}>
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
              <Box paddingLeft={entry.nested ? 2 : 0}>
                <Text color={entry.isError ? "red" : "green"}>{"● "}</Text>
                <Text bold>{formatToolName(entry.toolName ?? "tool")}</Text>
                {entry.text && <Text color="gray" dimColor>{"(" + entry.text + ")"}</Text>}
              </Box>
            )}
            {entry.type === "tool_result" && isDiffOutput(entry.text) && (() => {
              const { header, lines } = parseDiffOutput(entry.text);
              const indent = entry.nested ? 4 : 2;
              const maxLines = 15;
              const visibleLines = lines.slice(0, maxLines);
              const hiddenCount = lines.length - visibleLines.length;
              return (
                <Box flexDirection="column" paddingLeft={indent}>
                  <Box>
                    <Text color="green">{"⎿  "}</Text>
                    <Text bold>{header}</Text>
                  </Box>
                  {visibleLines.map((line, i) => {
                    const lineNumStr = line.lineNum !== undefined ? String(line.lineNum).padStart(4, " ") : "    ";
                    if (line.type === "add") {
                      return (
                        <Box key={i} paddingLeft={3}>
                          <Text color="gray" dimColor>{lineNumStr + " "}</Text>
                          <Text color="green">+ {line.text}</Text>
                        </Box>
                      );
                    }
                    if (line.type === "remove") {
                      return (
                        <Box key={i} paddingLeft={3}>
                          <Text color="gray" dimColor>{lineNumStr + " "}</Text>
                          <Text color="red">- {line.text}</Text>
                        </Box>
                      );
                    }
                    if (line.type === "context") {
                      return (
                        <Box key={i} paddingLeft={3}>
                          <Text color="gray" dimColor>{lineNumStr + "   " + line.text}</Text>
                        </Box>
                      );
                    }
                    if (line.type === "hunk") {
                      return (
                        <Box key={i} paddingLeft={3}>
                          <Text color="cyan" dimColor>{line.text}</Text>
                        </Box>
                      );
                    }
                    return (
                      <Box key={i} paddingLeft={3}>
                        <Text color="gray" dimColor>{line.text}</Text>
                      </Box>
                    );
                  })}
                  {hiddenCount > 0 && (
                    <Box paddingLeft={3}>
                      <Text color="gray" dimColor>{"  … +" + hiddenCount + " more lines"}</Text>
                    </Box>
                  )}
                </Box>
              );
            })()}
            {entry.type === "tool_result" && !isDiffOutput(entry.text) && (() => {
              const { preview, hidden } = formatToolResult(entry.text);
              const lines = preview.split("\n");
              const indent = entry.nested ? 4 : 2;
              return (
                <Box flexDirection="column" paddingLeft={indent}>
                  {lines.map((line, i) => (
                    <Box key={i}>
                      <Text color="green">{i === 0 ? "⎿  " : "   "}</Text>
                      <Text color={entry.isError ? "red" : "gray"} dimColor={!entry.isError}>{line}</Text>
                    </Box>
                  ))}
                  {hidden > 0 && (
                    <Box>
                      <Text color="gray" dimColor>{"   … +" + hidden + " lines (ctrl+o to expand)"}</Text>
                    </Box>
                  )}
                </Box>
              );
            })()}
            {entry.type === "tool_result_full" && (
              <Box flexDirection="column" paddingLeft={entry.nested ? 4 : 2}>
                {entry.text.split("\n").map((line, i) => (
                  <Box key={i}>
                    <Text color="green">{i === 0 ? "⎿  " : "   "}</Text>
                    <Text color={entry.isError ? "red" : "gray"} dimColor={!entry.isError}>{line}</Text>
                  </Box>
                ))}
              </Box>
            )}
            {entry.type === "subagent_done" && (
              <Box paddingLeft={2}>
                <Text color="gray" dimColor>{"  ⎿  " + entry.text}</Text>
              </Box>
            )}
            {entry.type === "system" && (
              <Text color="cyan" dimColor>{entry.text}</Text>
            )}
          </Box>
        )}
      </Static>
      {questionOverlay && (
        <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1} width={overlayWidth}>
          <Box marginBottom={1}>
            <Text bold color="cyan">{"? "}</Text>
            <Text bold>{questionOverlay.question}</Text>
          </Box>
          {questionOverlay.items.map((item, i) => (
            <Box key={i} flexDirection="column">
              <Box>
                <Text color={i === questionOverlay.selectedIndex ? "cyan" : "gray"}>
                  {i === questionOverlay.selectedIndex ? "❯ " : "  "}
                </Text>
                <Text color={i === questionOverlay.selectedIndex ? "cyan" : "gray"} bold={i === questionOverlay.selectedIndex}>
                  {item.label}
                </Text>
              </Box>
              {item.sublabel && (
                <Box paddingLeft={2}>
                  <Text color="gray" dimColor>{item.sublabel}</Text>
                </Box>
              )}
            </Box>
          ))}
          <Box marginTop={1}>
            <Text color="gray" dimColor>↑↓ navigate  ↵ select{questionOverlay.items.length <= 4 ? "  1-4 quick pick" : ""}  Esc cancel</Text>
          </Box>
        </Box>
      )}
      {liveTail && (
        <Box>
          <Text>{liveTail}</Text>
        </Box>
      )}
      {isRunning && (
        <Box flexDirection="column">
          <Box>
            <Text color="cyan">{SPIN_FRAMES[spinFrame]}</Text>
            <Text color="gray"> {statusVerb} · {formatElapsed(elapsedSecs)}{liveTokens > 0 ? ` · ↓ ${formatTokenCount(liveTokens)} tokens` : ""}{currentToolName ? ` · ${formatToolName(currentToolName)}` : ""} · esc to interrupt</Text>
          </Box>
          {tip && (
            <Box>
              <Text color="gray" dimColor>  Tip: {tip}</Text>
            </Box>
          )}
        </Box>
      )}
      {isRunning && agentTasks.some(t => t.status === "running") && (
        <Box flexDirection="column" marginTop={0}>
          {agentTasks.filter(t => t.status === "running").map(task => (
            <Box key={task.id}>
              <Text color="cyan">{"◯ "}</Text>
              <Text color="cyan">{task.agent}</Text>
              <Text color="gray" dimColor>
                {`  ${formatElapsed(Math.floor((Date.now() - task.startedAt) / 1000))}`}
              </Text>
            </Box>
          ))}
        </Box>
      )}
      {!isRunning && (
        <Box flexDirection="column" width={fullWidth}>
          {gitBranch && (
            <Box>
              <Text color="gray" dimColor>{"── "}</Text>
              <Text color="cyan" dimColor>{gitBranch}</Text>
              <Text color="gray" dimColor>{" ──"}</Text>
            </Box>
          )}
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
                  "/help","/save","/sessions","/load","/resume","/clear","/context",
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
          <Box justifyContent="space-between" width={fullWidth}>
            <Text color="gray" dimColor>  Tab · complete  ↵ · send  Ctrl+O · expand  Ctrl+C · exit</Text>
            <Text color={permMode === "plan" ? "yellow" : permMode === "auto" ? "green" : "gray"} dimColor>
              {PERM_MODE_LABELS[permMode]} · shift+tab
            </Text>
          </Box>
        </Box>
      )}
      {!isRunning && (
        <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} width={fullWidth}>
          <Text color="gray">{(() => {
            const parts: string[] = [];
            if (tokens.input + tokens.output > 0) parts.push(`${formatTokenCount(tokens.input)}↑ ${formatTokenCount(tokens.output)}↓ tokens`);
            const m = props.provider.getModel();
            if (m) parts.push(`model: ${m}`);
            return ` ${parts.join("  ·  ")} `;
          })()}</Text>
        </Box>
      )}
    </Box>
  );
};
