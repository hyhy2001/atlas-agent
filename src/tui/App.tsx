import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";

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
import {
  formatTokenCount,
  formatTimeAgo,
} from "./format.js";
import { SpinnerLine } from "./components/SpinnerLine.js";
import { MessageList } from "./components/MessageList.js";
import { QuestionOverlay } from "./components/QuestionOverlay.js";
import { SubagentTree } from "./components/SubagentTree.js";
import { PromptInput } from "./components/PromptInput.js";
import { THEMES, ThemeContext, type ThemeName } from "./theme.js";
import type { HistoryEntry, OverlayItem, AgentTask } from "./types.js";
import type { Skill } from "../skills.js";

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
  skills?: Skill[];
  theme?: string;
  mcpStatus?: Array<{ name: string; command: string; status: "connected" | "failed"; toolCount: number; error?: string }>;
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
  "version", "init", "diff", "undo", "agent", "agents", "model", "doctor", "output", "theme", "config", "worktree", "trust", "tasks", "cron", "team", "skills", "exit", "quit",
];

interface AtSuggestion { path: string; indices?: number[] }

type PermMode = "ask" | "auto" | "plan";
const PERM_MODES: PermMode[] = ["ask", "auto", "plan"];
const PERM_MODE_LABELS: Record<PermMode, string> = {
  ask: "ask",
  auto: "auto-approve",
  plan: "plan only",
};

export function formatApiError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/429|rate.?limit/i.test(msg)) {
    return `⏳ Rate limit hit. The model is throttling — wait a moment then retry.\n   ${msg.slice(0, 200)}`;
  }
  if (/529|overloaded/i.test(msg)) {
    return `⚠ API overloaded. The provider is temporarily unavailable — retry in ~30s.\n   ${msg.slice(0, 200)}`;
  }
  if (/ECONNRESET|EPIPE|socket hang up/i.test(msg)) {
    return `⚠ Connection dropped. Atlas auto-recreates the client — retry should work.\n   ${msg.slice(0, 200)}`;
  }
  if (/401|unauthorized|forbidden/i.test(msg)) {
    return `🔒 Authentication failed. Check ATLAS_AUTH_TOKEN.\n   ${msg.slice(0, 200)}`;
  }
  if (/context.*length|max.*tokens.*exceed|prompt is too long/i.test(msg)) {
    return `📏 Context too long. Try /compact to summarize and free up space.\n   ${msg.slice(0, 200)}`;
  }
  return `Error: ${msg}`;
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
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  const [outputStyle, setOutputStyle] = useState<"default" | "compact" | "verbose">("default");
  const [themeName, setThemeName] = useState<ThemeName>((props.theme as ThemeName) ?? "dark");
  const theme = THEMES[themeName];
  const [spinFrame, setSpinFrame] = useState(0);
  const SPIN_FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  const [liveTail, setLiveTail] = useState("");
  const [currentToolName, setCurrentToolName] = useState("");
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [statusVerb, setStatusVerb] = useState("Working");
  const [tip, setTip] = useState<string | null>(null);
  const [reasoningPreview, setReasoningPreview] = useState("");
  const [termCols, setTermCols] = useState(process.stdout.columns ?? 80);

  useEffect(() => {
    const onResize = () => setTermCols(process.stdout.columns ?? 80);
    process.stdout.on("resize", onResize);
    return () => { process.stdout.off("resize", onResize); };
  }, []);

  const fullWidth = termCols - 2;
  const overlayWidth = Math.max(40, termCols - 4);
  const [tokens, setTokens] = useState({ input: 0, output: 0, cached: 0 });
  const [liveTokens, setLiveTokens] = useState(0);
  const [planActive, setPlanActive] = useState(Boolean(props.startInPlanMode));
  const [permMode, setPermMode] = useState<PermMode>("ask");
  const [gitBranch, setGitBranch] = useState<string>("");
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);
  const [atSuggestions, setAtSuggestions] = useState<AtSuggestion[]>([]);
  const [atSuggestionIndex, setAtSuggestionIndex] = useState(0);
  const [slashCmdIndex, setSlashCmdIndex] = useState(0);
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
  const nestedCallCountRef = useRef(0);
  const pendingAtQueryRef = useRef<string | null>(null);
  const inputHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const savedInputRef = useRef<string>("");
  const pasteNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pasteRefsRef = useRef<Map<string, string>>(new Map());
  const pasteCounterRef = useRef(0);
  const queuedMessageRef = useRef<string | null>(null);
  const handleSubmitRef = useRef<(value: string) => Promise<void>>(async () => {});

  // Truncate the input when it grows past 10k chars (paste-via-bracketed-mode
  // that bypassed paste detection, or long accumulated content). Replace the
  // middle with a [paste #N: M lines] ref so the prompt stays readable, while
  // the full content is restored at submit time. cc-ref behaviour parity.
  useEffect(() => {
    const TRUNCATION_THRESHOLD = 10_000;
    const PREVIEW_LENGTH = 1000;
    if (input.length <= TRUNCATION_THRESHOLD) return;
    const head = Math.floor(PREVIEW_LENGTH / 2);
    const tail = Math.floor(PREVIEW_LENGTH / 2);
    const middle = input.slice(head, -tail);
    const lineCount = middle.split("\n").length;
    const id = String(++pasteCounterRef.current);
    pasteRefsRef.current.set(id, middle);
    const placeholder = `[paste #${id}: ${lineCount} line${lineCount > 1 ? "s" : ""}]`;
    setInput(input.slice(0, head) + placeholder + input.slice(-tail));
  }, [input]);

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
    if (props.executor.ctx) {
      props.executor.ctx.askUser = (question: string, options: string[]) => {
        return new Promise<string>((resolve) => {
          setQuestionOverlay({
            question,
            items: options.map(o => ({ label: o, value: o })),
            selectedIndex: 0,
            resolve,
          });
        });
      };
    }
    return () => {
      if (props.executor.ctx) props.executor.ctx.askUser = undefined;
    };
  }, [props.executor]);

  const allCommandNames = [...COMMANDS, ...(props.commands ?? []).map(c => c.name)];
  const subagentNames = ["atlas-swift", "atlas-forge", "atlas-deep", ...(props.subagents ?? []).map(s => s.name)];
  const completer = createCompleter({ commands: allCommandNames, subagentNames, cwd: process.cwd() });
  const suggestion = (() => {
    if (!input.startsWith("/")) return null;
    const [hits] = completer(input);
    return hits.find(h => h !== input) ?? null;
  })();
  const slashCmds = (() => {
    if (!input.startsWith("/") || input.length < 1) return [];
    const allCmds = [
      "/help","/save","/sessions","/load","/resume","/clear","/context",
      "/plan","/execute","/compact","/cost","/stats","/version","/init","/bg",
      "/diff","/undo","/agent","/agents","/model","/doctor","/output","/theme","/config","/mcp",
      "/worktree","/trust","/tasks","/cron","/team","/skills",
      ...(props.skills ?? []).map(s => `/${s.name}`),
      ...(props.commands ?? []).map(c => `/${c.name}`),
    ];
    return allCmds.filter(c => c.startsWith(input)).slice(0, 8);
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

  // Cache file list — built once on first @ trigger, filtered in-memory per keystroke
  const fileListCacheRef = useRef<string[] | null>(null);
  const fileListCacheTimeRef = useRef<number>(0);
  const FILE_CACHE_TTL = 30000; // rebuild cache every 30s

  async function buildFileCache(): Promise<string[]> {
    const now = Date.now();
    if (fileListCacheRef.current && now - fileListCacheTimeRef.current < FILE_CACHE_TTL) {
      return fileListCacheRef.current;
    }
    try {
      const { execSync } = await import("node:child_process");
      const excludes = "-not -path './node_modules*' -not -path './.git*' -not -path './dist*' -not -path './deps*' -not -path './release*' -not -path './.atlas/sessions*' -not -path './.atlas/cache*' -not -path './.atlas/bin*' -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/deps/*' -not -path '*/release/*'";
      // Directories first (with trailing slash), then files — no per-entry statSync
      const dirRaw = execSync(
        `find . -type d ${excludes} 2>/dev/null | head -1000`,
        { encoding: "utf8", cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 }
      ).trim();
      const fileRaw = execSync(
        `find . -type f ${excludes} 2>/dev/null | head -2000`,
        { encoding: "utf8", cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 }
      ).trim();
      const dirs = dirRaw ? dirRaw.split("\n").map(f => f.replace(/^\.\//, "")).filter(f => f && f !== ".").map(f => f + "/") : [];
      const files = fileRaw ? fileRaw.split("\n").map(f => f.replace(/^\.\//, "")).filter(Boolean) : [];
      const entries = [...dirs, ...files];
      if (entries.length === 0) return [];
      fileListCacheRef.current = entries;
      fileListCacheTimeRef.current = now;
      return entries;
    } catch {
      return [];
    }
  }

  function filterAtSuggestions(entries: string[], query: string): AtSuggestion[] {
    const depthOf = (s: string) => {
      const trimmed = s.endsWith("/") ? s.slice(0, -1) : s;
      return trimmed.split("/").length;
    };
    const q = query.toLowerCase().replace(/[^a-z0-9._/-]/g, "");
    if (!q) {
      return entries
        .sort((a, b) => {
          const da = depthOf(a), db = depthOf(b);
          if (da !== db) return da - db;
          // Folders (end with /) before files at same depth
          const aDir = a.endsWith("/"), bDir = b.endsWith("/");
          if (aDir !== bDir) return aDir ? -1 : 1;
          return a.localeCompare(b);
        })
        .slice(0, 12)
        .map(path => ({ path }));
    }

    const results: AtSuggestion[] = [];
    for (const entry of entries) {
      const lower = entry.toLowerCase();
      const parts = lower.split("/");
      const base = parts[parts.length - 1] ?? lower;
      const depth = parts.length;

      let score = -1;
      let indices: number[] = [];

      if (base === q) {
        score = 1000 - depth;
        indices = Array.from({ length: base.length }, (_, i) => lower.length - base.length + i);
      } else if (base.startsWith(q)) {
        score = 800 - depth;
        indices = Array.from({ length: q.length }, (_, i) => lower.length - base.length + i);
      } else if (base.includes(q)) {
        const idx = base.indexOf(q);
        score = 600 - depth;
        const offset = lower.length - base.length;
        indices = Array.from({ length: q.length }, (_, i) => offset + idx + i);
      } else if (lower.includes(q)) {
        const idx = lower.indexOf(q);
        score = 400 - depth;
        indices = Array.from({ length: q.length }, (_, i) => idx + i);
      } else {
        const target = base.includes(q[0] ?? "") ? base : lower;
        const offset = target === base ? lower.length - base.length : 0;
        const matchIdx: number[] = [];
        let qi = 0;
        for (let i = 0; i < target.length && qi < q.length; i++) {
          if (target[i] === q[qi]) { matchIdx.push(offset + i); qi++; }
        }
        if (qi === q.length) {
          score = 200 - depth;
          indices = matchIdx;
        }
      }

      if (score > 0) results.push({ path: entry, indices });
    }

    return results
      .sort((a, b) => {
        const scoreOf = (s: AtSuggestion) => {
          const lower = s.path.toLowerCase();
          const base = lower.split("/").pop() ?? lower;
          const depth = s.path.split("/").length;
          if (base === q) return 1000 - depth;
          if (base.startsWith(q)) return 800 - depth;
          if (base.includes(q)) return 600 - depth;
          if (lower.includes(q)) return 400 - depth;
          return 200 - depth;
        };
        return scoreOf(b) - scoreOf(a);
      })
      .slice(0, 10);
  }

  async function getAtSuggestions(query: string): Promise<AtSuggestion[]> {
    const entries = await buildFileCache();
    return filterAtSuggestions(entries, query);
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
    setReasoningPreview("");
    setAgentTasks([]);
    let rawSource = "";
    let committedLen = 0;

    // Install tool callbacks on executor to capture tool call events when running in Ink mode
    try {
      nestedCallCountRef.current = 0;
      (props.executor as any)._onToolCall = (name: string, summary: string, nested = false) => {
        if (nested) {
          // Don't dump child tool calls into the scrollback — cc-ref-style
          // shows only one tree line per subagent. Track count + last tool
          // info on the agentTasks entry so SubagentTree can render it.
          nestedCallCountRef.current++;
          setAgentTasks(tasks => {
            const last = [...tasks].reverse().find(t => t.status === "running");
            if (!last) return tasks;
            return tasks.map(t => t === last
              ? { ...t, toolUses: (t.toolUses ?? 0) + 1, lastToolInfo: summary ? `${name}(${summary})` : name }
              : t);
          });
          return;
        }
        setHistory(h => [...h, { type: "tool_call", text: summary, toolName: name, nested }]);
        setCurrentToolName(name);
      };
      (props.executor as any)._onToolResult = (name: string, resultStr: string, isError: boolean, nested = false) => {
        if (nested) return;  // child results stay inside the agent's tree, not scrollback
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
        nestedCallCountRef.current = 0;
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
        onReasoning: (text: string) => {
          const match = text.match(/\*\*([^*]+)\*\*/);
          if (match) {
            setReasoningPreview(match[1].trim());
          } else {
            const line = text.split("\n").find(l => l.trim()) ?? "";
            setReasoningPreview(line.trim().slice(0, 60));
          }
        },
      });
      setTokens(t => ({ input: t.input + result.inputTokens, output: t.output + result.outputTokens, cached: t.cached + (result.cachedTokens ?? 0) }));
      // Flush any batched complete lines first, then commit remaining tail
      const pending = pendingCommitRef.current;
      pendingCommitRef.current = "";
      const tail = rawSource.slice(committedLen);
      const finalText = pending + tail;
      if (finalText.trim()) {
        setHistory(h => [...h, { type: "assistant", text: finalText.replace(/\n$/, "") }]);
      }
      setLiveTail("");
      setReasoningPreview("");
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
      addSystem(formatApiError(err));
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
    if (value === "/config") {
      const mainModel = props.provider.getModel();
      const fastModel = fastModelRef.current ?? process.env["ATLAS_FAST_MODEL"] ?? "(uses main)";
      const reasoningModel = reasoningModelRef.current ?? process.env["ATLAS_REASONING_MODEL"] ?? "(uses main)";
      const mcpCount = props.mcpStatus?.filter(m => m.status === "connected").length ?? 0;
      const lines = [
        `Atlas configuration:`,
        ``,
        `Models:`,
        `  leader:    ${mainModel}`,
        `  fast:      ${fastModel}`,
        `  reasoning: ${reasoningModel}`,
        ``,
        `Session:`,
        `  theme:        ${themeName}`,
        `  output style: ${outputStyle}`,
        `  permission:   ${PERM_MODE_LABELS[permMode]}`,
        `  plan mode:    ${planActive ? "on" : "off"}`,
        ``,
        `Tools & extensions:`,
        `  leader tools: ${props.toolRegistry.getAll().length}`,
        `  total tools:  ${props.totalToolCount ?? props.toolRegistry.getAll().length}`,
        `  MCP servers:  ${mcpCount} connected`,
        `  skills:       ${props.skills?.length ?? 0}`,
        `  subagents:    ${(props.subagents ?? []).length}`,
        ``,
        `Change: /model · /theme · /output · shift+tab (permission)`,
      ];
      addSystem(lines.join("\n"));
      return true;
    }
    if (value === "/context") {
      const CONTEXT_LIMIT = 200_000;
      const sysTokens = Math.ceil((props.systemPrompt?.length ?? 0) / 4);
      const msgTokens = Math.ceil(JSON.stringify(messagesRef.current).length / 4);
      const toolTokens = Math.ceil(JSON.stringify(props.toolRegistry.getAll().map(t => ({ n: t.name, d: t.description, s: t.inputSchema }))).length / 4);
      const used = sysTokens + msgTokens + toolTokens;
      const pct = Math.min(100, Math.round((used / CONTEXT_LIMIT) * 100));
      const barWidth = 30;
      const filled = Math.round((pct / 100) * barWidth);
      const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
      const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
      const lines = [
        `Context usage: ${bar} ${pct}%  (${fmt(used)} / ${fmt(CONTEXT_LIMIT)})`,
        ``,
        `  System prompt: ${fmt(sysTokens)} tokens`,
        `  Messages (${messagesRef.current.length}): ${fmt(msgTokens)} tokens`,
        `  Tool schemas (${props.toolRegistry.getAll().length}): ${fmt(toolTokens)} tokens`,
        ``,
        props.projectContextPath ? `Project context: ${props.projectContextPath}` : `No project context (run /init)`,
        pct > 70 ? `\n⚠ Context >70% — consider /compact to free space.` : ``,
      ].filter(Boolean);
      addSystem(lines.join("\n"));
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
        setHistory(h => [...h, { type: "compact_boundary", text: new Date().toLocaleTimeString() }]);
      } catch (err) {
        addSystem(`Compact failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return true;
    }
    if (value === "/output") {
      const chosen = await new Promise<string>((resolve) => {
        setQuestionOverlay({
          question: "Output style",
          items: [
            { label: "default", sublabel: "5 lines preview per tool result", value: "default" },
            { label: "compact", sublabel: "1-line summary per tool result", value: "compact" },
            { label: "verbose", sublabel: "Full output, no truncation", value: "verbose" },
          ],
          selectedIndex: ["default", "compact", "verbose"].indexOf(outputStyle),
          resolve,
        });
      });
      if (chosen === "default" || chosen === "compact" || chosen === "verbose") {
        setOutputStyle(chosen);
        addSystem(`Output style: ${chosen}`);
      }
      return true;
    }
    if (value === "/theme") {
      const chosen = await new Promise<string>((resolve) => {
        setQuestionOverlay({
          question: "Theme",
          items: [
            { label: "dark", sublabel: "Cyan accents (default)", value: "dark" },
            { label: "light", sublabel: "Blue accents", value: "light" },
            { label: "monokai", sublabel: "Magenta + yellow", value: "monokai" },
            { label: "solarized", sublabel: "Muted blue + cyan", value: "solarized" },
          ],
          selectedIndex: ["dark", "light", "monokai", "solarized"].indexOf(themeName),
          resolve,
        });
      });
      if (chosen === "dark" || chosen === "light" || chosen === "monokai" || chosen === "solarized") {
        setThemeName(chosen);
        addSystem(`Theme: ${chosen}`);
        try {
          const { paths } = await import("../paths.js");
          const configPath = paths.config();
          await fs.mkdir(path.dirname(configPath), { recursive: true });
          let cfg: Record<string, unknown> = {};
          try {
            cfg = JSON.parse(await fs.readFile(configPath, "utf-8")) as Record<string, unknown>;
          } catch {}
          cfg.theme = chosen;
          await fs.writeFile(configPath, JSON.stringify(cfg, null, 2), "utf-8");
        } catch {}
      }
      return true;
    }
    if (value === "/version") {
      try {
        const pkg = await fs.readFile(path.join(process.cwd(), "package.json"), "utf-8");
        const parsed = JSON.parse(pkg);
        addSystem(`atlas ${parsed.version} — model: ${props.provider.getModel()}`);
      } catch (err) {
        addSystem(`Could not read version: ${err instanceof Error ? err.message : String(err)}`);
      }
      return true;
    }
    if (value === "/cost") {
      const inCost = (tokens.input / 1_000_000) * 1.5;
      const outCost = (tokens.output / 1_000_000) * 15.0;
      const total = tokens.input + tokens.output;
      const mainModel = props.provider.getModel();
      const fastModel = fastModelRef.current ?? process.env["ATLAS_FAST_MODEL"] ?? mainModel;
      const reasoningModel = reasoningModelRef.current ?? process.env["ATLAS_REASONING_MODEL"] ?? mainModel;
      const cacheHitPct = tokens.input > 0 ? ((tokens.cached / tokens.input) * 100).toFixed(1) : "0.0";
      const lines = [
        `Token usage this session:`,
        `  Input:     ${formatTokenCount(tokens.input)} tokens  (~$${inCost.toFixed(4)})`,
        `  Output:    ${formatTokenCount(tokens.output)} tokens  (~$${outCost.toFixed(4)})`,
        `  Total:     ${formatTokenCount(total)} tokens  (~$${(inCost + outCost).toFixed(4)})`,
        tokens.cached > 0
          ? `  Cached:    ${formatTokenCount(tokens.cached)} tokens  (${cacheHitPct}% cache hit)`
          : `  Cached:    0 tokens  (no cache hits yet — proxy may not support prompt caching)`,
        ``,
        `Model tiers:`,
        `  leader:    ${mainModel}`,
        `  fast:      ${fastModel}`,
        `  reasoning: ${reasoningModel}`,
      ];
      addSystem(lines.join("\n"));
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
      addSystem(`Commands:\n  /save /sessions /load <id> /resume /clear /context\n  /plan /execute /compact /cost /stats [all|<id>] /init\n  /bg [list|<cmd>|kill <id>|log <id>] : background bash jobs\n  /diff [path] /undo /worktree [list|create|enter|exit|remove]\n  /agent <name> [prompt] /agents /model [tier] [name] /doctor /trust [dir]\n  /mcp : list connected MCP servers and their tools\n\nMulti-line: type \`\`\` to start/end a block, or end a line with \\ to continue\n@file.ts injects file content into your prompt`);
      return true;
    }
    if (value === "/agents") {
      const agents = props.subagents ?? listSubagents();
      addSystem("Available agents:\n" + agents.map(a => `  ${a.name}  — ${a.description}`).join("\n"));
      return true;
    }
    if (value === "/mcp") {
      const all = props.toolRegistry.getAll();
      // MCP tools are named "<server>__<tool>"
      const byServer = new Map<string, string[]>();
      for (const tool of all) {
        const sep = tool.name.indexOf("__");
        if (sep > 0) {
          const server = tool.name.slice(0, sep);
          const toolName = tool.name.slice(sep + 2);
          if (!byServer.has(server)) byServer.set(server, []);
          byServer.get(server)!.push(toolName);
        }
      }

      const lines: string[] = [];
      const mcpStatus = props.mcpStatus ?? [];

      if (mcpStatus.length === 0 && byServer.size === 0) {
        addSystem("No MCP servers configured.\n\nAdd servers in .atlas/settings.json under \"mcpServers\".");
        return true;
      }

      // Show configured servers with status
      for (const entry of mcpStatus) {
        if (entry.status === "connected") {
          lines.push(`● ${entry.name}  (${entry.toolCount} tools)  ✓ connected`);
          const tools = byServer.get(entry.name) ?? [];
          for (const t of tools) lines.push(`    ${t}`);
        } else {
          lines.push(`✗ ${entry.name}  — failed to connect`);
          lines.push(`    command: ${entry.command}`);
          if (entry.error) lines.push(`    error: ${entry.error}`);
          lines.push(`    → If glibc mismatch: run  make build-mcp`);
          lines.push(`    → If command not found: run  make install-mcp`);
        }
      }

      // Show any MCP tools not in mcpStatus (edge case)
      for (const [server, tools] of byServer) {
        if (!mcpStatus.find(e => e.name === server)) {
          lines.push(`● ${server}  (${tools.length} tools)`);
          for (const t of tools) lines.push(`    ${t}`);
        }
      }

      addSystem(lines.join("\n"));
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
    if (value === "/bg" || value.startsWith("/bg ")) {
      const arg = value.slice(3).trim();
      const { startJob, listJobs, getJob, killJob, formatJob } = await import("./background.js");

      if (!arg || arg === "list") {
        const jobs = listJobs();
        if (jobs.length === 0) {
          addSystem("No background jobs.");
        } else {
          addSystem("Background jobs:\n" + jobs.map(formatJob).join("\n"));
        }
        return true;
      }
      if (arg.startsWith("kill ")) {
        const id = arg.slice(5).trim();
        addSystem(killJob(id) ? `Killed job ${id}` : `Job ${id} not found or already finished`);
        return true;
      }
      if (arg.startsWith("log ")) {
        const id = arg.slice(4).trim();
        const job = getJob(id);
        if (!job) {
          addSystem(`Job ${id} not found`);
        } else {
          const out = job.output.length > 4000 ? job.output.slice(-4000) + "\n[...output truncated to last 4000 chars]" : job.output;
          addSystem(`[${id}] ${job.command}\n${formatJob(job)}\n\n${out || "(no output yet)"}`);
        }
        return true;
      }
      const job = startJob(arg, process.cwd());
      addSystem(`Started background job [${job.id}]: ${arg}\nUse "/bg log ${job.id}" to view output, "/bg kill ${job.id}" to stop.`);
      return true;
    }
    if (value === "/diff" || value.startsWith("/diff ")) {
      const arg = value.slice(5).trim();
      // Get file-level summary first (--stat), then full diff
      const stat = await new Promise<string>(resolve => {
        const child = spawn("git", ["diff", "--stat", ...(arg ? ["--", arg] : [])], { cwd: process.cwd() });
        let out = "";
        child.stdout.on("data", d => { out += d.toString(); });
        child.on("close", () => resolve(out.trim()));
      });
      const full = await new Promise<string>(resolve => {
        const child = spawn("git", ["diff", "--color=always", ...(arg ? ["--", arg] : [])], { cwd: process.cwd() });
        let out = "";
        child.stdout.on("data", d => { out += d.toString(); });
        child.stderr.on("data", d => { out += d.toString(); });
        child.on("close", () => resolve(out));
      });
      if (!stat && !full.trim()) {
        addSystem("No changes.");
      } else {
        const fileCount = stat.split("\n").filter(l => l.includes("|")).length;
        const header = stat ? `── ${fileCount} file${fileCount !== 1 ? "s" : ""} changed ──\n${stat}\n${"─".repeat(40)}\n` : "";
        addSystem(header + full.trim());
      }
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
      const trustedDirs = props.executor.ctx?.trustedDirs ?? [];
      if (!trustedDirs.includes(resolved)) trustedDirs.push(resolved);
      if (props.executor.ctx) props.executor.ctx.trustedDirs = trustedDirs;
      addSystem(`Trusted: ${resolved} (no permission prompts for files in this directory)`);
      return true;
    }
    if (value === "/doctor") {
      const checks: string[] = [];
      const baseUrl = process.env["ATLAS_BASE_URL"] ?? (props.provider as any)._baseUrl ?? "(not exposed)";
      const authToken = process.env["ATLAS_AUTH_TOKEN"] ?? "";
      checks.push(`Config:`);
      checks.push(`  ATLAS_BASE_URL:    ${baseUrl ? "✓ set" : "✗ missing"}`);
      checks.push(`  ATLAS_AUTH_TOKEN:  ${authToken ? "✓ set" : "✗ missing"}`);
      checks.push(`  Model:             ${props.provider.getModel() || "✗ not set"}`);
      checks.push(``);
      const mcpList = props.mcpStatus ?? [];
      checks.push(`MCP servers (${mcpList.length}):`);
      if (mcpList.length === 0) {
        checks.push(`  (none configured)`);
      } else {
        for (const s of mcpList) {
          const icon = s.status === "connected" ? "✓" : "✗";
          const detail = s.status === "connected" ? `${s.toolCount} tools` : (s.error ?? "failed");
          checks.push(`  ${icon} ${s.name}  — ${detail}`);
        }
      }
      checks.push(``);
      checks.push(`Tools: ${props.totalToolCount ?? props.toolRegistry.getAll().length} registered`);
      checks.push(``);
      checks.push(`Session: ${sessionIdRef.current}`);
      checks.push(`  Messages: ${messagesRef.current.length}`);
      checks.push(`  Tokens:   ${formatTokenCount(tokens.input + tokens.output)}`);
      addSystem(checks.join("\n"));
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
    if (value === "/tasks") {
      const { getTaskStore } = await import("../tasks/store.js");
      const store = await getTaskStore(process.cwd());
      const tasks = store.list();
      if (tasks.length === 0) addSystem("No tasks.");
      else {
        const lines = tasks.map(t => {
          const blocked = t.blockedBy.length > 0 ? `  [blocked by: ${t.blockedBy.map(b => "#" + b).join(", ")}]` : "";
          const owner = t.owner ? `  (${t.owner})` : "";
          return `  #${t.id} [${t.status}]${owner} ${t.subject}${blocked}`;
        });
        addSystem(`Tasks (${tasks.length}):\n${lines.join("\n")}`);
      }
      return true;
    }
    if (value === "/cron") {
      const { getCronScheduler } = await import("../cron/scheduler.js");
      const scheduler = getCronScheduler(path.join(process.cwd(), ".atlas", "cron.json"));
      const jobs = scheduler.list();
      if (jobs.length === 0) addSystem("No scheduled jobs.");
      else {
        const lines = jobs.map(j => {
          const recurring = j.recurring ? " (recurring)" : "";
          const durable = j.durable ? " [durable]" : "";
          const promptShort = j.prompt.length > 50 ? j.prompt.slice(0, 50) + "…" : j.prompt;
          return `  #${j.id} ${j.cron} — next: ${j.nextFireAt}${recurring}${durable} — "${promptShort}"`;
        });
        addSystem(`Scheduled jobs (${jobs.length}):\n${lines.join("\n")}`);
      }
      return true;
    }
    if (value === "/team") {
      const { getTeamManager } = await import("../coordinator/team.js");
      const teams = getTeamManager().list();
      if (teams.length === 0) addSystem("No teams.");
      else {
        const lines = teams.map(t => {
          const members = Array.from(t.members.values()).map(m => `${m.name}(${m.profile})`).join(", ");
          return `  ${t.name} — ${t.members.size} members: ${members}`;
        });
        addSystem(`Teams (${teams.length}):\n${lines.join("\n")}`);
      }
      return true;
    }
    if (value === "/skills") {
      const list = props.skills ?? [];
      if (list.length === 0) addSystem("No skills loaded.");
      else addSystem("Skills:\n" + list.map(s => `  /${s.name} — ${s.description}`).join("\n"));
      return true;
    }
    const skillMatch = (props.skills ?? []).find(s => value === `/${s.name}` || value.startsWith(`/${s.name} `));
    if (skillMatch) {
      const args = value.slice(skillMatch.name.length + 1).trim();
      await runPrompt(`The user invoked the /${skillMatch.name} skill${args ? ` with: ${args}` : ""}. Apply its workflow.`);
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
    // Expand [paste #N: M lines] placeholders back to their full content
    const expanded = value.replace(/\[paste #(\d+): \d+ lines?\]/g, (_, id) => {
      return pasteRefsRef.current.get(id) ?? _;
    });
    const trimmed = expanded.trim();
    setInput("");
    if (trimmed && (inputHistoryRef.current.length === 0 || inputHistoryRef.current[inputHistoryRef.current.length - 1] !== trimmed)) {
      inputHistoryRef.current.push(trimmed);
    }
    historyIndexRef.current = -1;

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

  handleSubmitRef.current = handleSubmit;

  useEffect(() => {
    queuedMessageRef.current = queuedMessage;
  }, [queuedMessage]);

  useEffect(() => {
    if (!isRunning && queuedMessageRef.current) {
      const msg = queuedMessageRef.current;
      queuedMessageRef.current = null;
      setQueuedMessage(null);
      handleSubmitRef.current(msg);
    }
  }, [isRunning]);

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

    if (isRunning && key.return && input.trim()) {
      const queued = input.trim();
      queuedMessageRef.current = queued;
      setQueuedMessage(queued);
      setInput("");
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
      if (slashCmds.length > 0) {
        setInput(slashCmds[slashCmdIndex] + " ");
        setSlashCmdIndex(0);
        return;
      }
      if (atSuggestions.length > 0) {
        const chosen = atSuggestions[atSuggestionIndex].path;
        const newVal = input.replace(/@([\w./\-]*)$/, `@${chosen}`);
        setInput(newVal);
        if (chosen.endsWith("/")) {
          pendingAtQueryRef.current = chosen;
          getAtSuggestions(chosen).then(s => {
            if (pendingAtQueryRef.current !== chosen) return;
            setAtSuggestions(s);
            setAtSuggestionIndex(0);
          });
        } else {
          setAtSuggestions([]);
        }
        return;
      }
      return;
    }

    // Enter → submit
    if (key.return) {
      // If slash command list is showing and user navigated (not index 0 from typing),
      // treat Enter as selecting the highlighted command
      if (slashCmds.length > 0 && slashCmdIndex > 0) {
        const chosen = slashCmds[slashCmdIndex];
        setInput("");
        setSlashCmdIndex(0);
        handleSubmit(chosen);
        return;
      }
      const value = input;
      setInput("");
      setSlashCmdIndex(0);
      setAtSuggestions([]);
      if (value.trim()) handleSubmit(value);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      setInput((s) => s.slice(0, -1));
      setAtSuggestions([]);
      return;
    }

    // Navigate slash command suggestions with arrow keys
    if (slashCmds.length > 0) {
      if (key.upArrow) {
        setSlashCmdIndex(i => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSlashCmdIndex(i => Math.min(slashCmds.length - 1, i + 1));
        return;
      }
    }

    // Navigate @ suggestions with arrow keys
    if (atSuggestions.length > 0) {
      if (key.upArrow) {
        setAtSuggestionIndex(i => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setAtSuggestionIndex(i => Math.min(atSuggestions.length - 1, i + 1));
        return;
      }
    }

    // Up arrow — history back
    if (key.upArrow && slashCmds.length === 0 && atSuggestions.length === 0) {
      const hist = inputHistoryRef.current;
      if (hist.length === 0) return;
      if (historyIndexRef.current === -1) {
        savedInputRef.current = input;
        historyIndexRef.current = hist.length - 1;
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
      }
      setInput(hist[historyIndexRef.current]);
      return;
    }
    // Down arrow — history forward
    if (key.downArrow && slashCmds.length === 0 && atSuggestions.length === 0) {
      if (historyIndexRef.current === -1) return;
      if (historyIndexRef.current < inputHistoryRef.current.length - 1) {
        historyIndexRef.current++;
        setInput(inputHistoryRef.current[historyIndexRef.current]);
      } else {
        historyIndexRef.current = -1;
        setInput(savedInputRef.current);
      }
      return;
    }

    // Skip other special keys
    if (key.escape || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.pageDown || key.pageUp || key.meta) return;

    // Regular character — append
    if (inputChar && !key.ctrl) {
      historyIndexRef.current = -1;
      // Detect paste: large input arrives in one event. Store the content
      // in pasteRefsRef and insert a [paste #N: M lines] placeholder so
      // the prompt stays compact. Expanded back at submit time.
      if (inputChar.length >= 200 || inputChar.split("\n").length >= 3) {
        const lineCount = inputChar.split("\n").length;
        const id = String(++pasteCounterRef.current);
        pasteRefsRef.current.set(id, inputChar);
        const placeholder = `[paste #${id}: ${lineCount} line${lineCount > 1 ? "s" : ""}]`;
        const newInput = input + placeholder;
        setPasteNotice(`Pasted ${lineCount} line${lineCount > 1 ? "s" : ""} — ${placeholder}`);
        if (pasteNoticeTimerRef.current) clearTimeout(pasteNoticeTimerRef.current);
        pasteNoticeTimerRef.current = setTimeout(() => setPasteNotice(null), 2000);
        setInput(newInput);
        setSlashCmdIndex(0);
        return;
      }
      // Use a functional updater so this runs AFTER any in-flight setInput
      // (e.g. a backspace event from the same tick when an IME splits a
      // chunk into DEL + composed char). Reading `input` from closure here
      // would clobber the backspace and leave "Baây" instead of "Bây".
      const newInput = input + inputChar;
      setInput(s => s + inputChar);
      setSlashCmdIndex(0);
      const atMatch = newInput.match(/@([\w./\-]*)$/);
      if (atMatch) {
        const query = atMatch[1];
        const pendingQuery = query;
        pendingAtQueryRef.current = pendingQuery;
        getAtSuggestions(query).then(suggestions => {
          if (pendingAtQueryRef.current !== pendingQuery) return;
          setAtSuggestions(suggestions);
          setAtSuggestionIndex(0);
        });
      } else {
        pendingAtQueryRef.current = null;
        setAtSuggestions([]);
      }
    }
  });

  return (
    <ThemeContext.Provider value={theme}>
      <Box flexDirection="column">
        <MessageList history={history} outputStyle={outputStyle} />
        {liveTokens > 80000 && (
          <Box paddingX={1}>
            <Text color="yellow">{"⚠ "}</Text>
            <Text color="yellow" dimColor>{"Context window >80% full — consider /compact to free space"}</Text>
          </Box>
        )}
        {!liveTokens || liveTokens <= 80000 ? (() => {
          const estimatedCost = (tokens.input / 1_000_000) * 1.5 + (tokens.output / 1_000_000) * 15.0;
          return estimatedCost > 1.0 ? (
            <Box paddingX={1}>
              <Text color={theme.warning}>{"💰 "}</Text>
              <Text color={theme.warning} dimColor>{`Estimated session cost: $${estimatedCost.toFixed(2)} — use /cost for breakdown`}</Text>
            </Box>
          ) : null;
        })() : null}
        <QuestionOverlay overlay={questionOverlay} width={overlayWidth} />
        {liveTail && (
          <Box>
            <Text>{liveTail}</Text>
          </Box>
        )}
        {isRunning && (
          <SpinnerLine
            spinFrame={spinFrame}
            spinFrames={SPIN_FRAMES}
            statusVerb={statusVerb}
            elapsedSecs={elapsedSecs}
            liveTokens={liveTokens}
            currentToolName={currentToolName}
            reasoningPreview={reasoningPreview}
            tip={tip}
          />
        )}
        {isRunning && <SubagentTree tasks={agentTasks} />}
        <PromptInput
          fullWidth={fullWidth}
          gitBranch={gitBranch}
          planActive={planActive}
          multiline={multiline}
          input={input}
          slashCmds={slashCmds}
          slashCmdIndex={slashCmdIndex}
          atSuggestions={atSuggestions}
          atSuggestionIndex={atSuggestionIndex}
          permMode={permMode}
          permModeLabels={PERM_MODE_LABELS}
          tokens={tokens}
          modelName={props.provider.getModel()}
          isRunning={isRunning}
          queuedMessage={queuedMessage}
        />
      </Box>
    </ThemeContext.Provider>
  );
};
