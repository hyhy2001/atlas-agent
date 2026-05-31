import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { OpenAIProvider } from "../provider/openai.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolExecutor } from "../tools/executor.js";
import type { MessageParam } from "../provider/types.js";
import { appendCompactBoundary, appendMessage, generateSessionId, generateSessionTitle, initSession, listSessions, loadSession, saveSession, type Session } from "../sessions.js";
import { paths } from "../paths.js";
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
import { TranscriptPager } from "./components/TranscriptPager.js";
import { QuestionOverlay } from "./components/QuestionOverlay.js";
import { PermissionRequest, type PermissionKind } from "./components/PermissionRequest.js";
import { SubagentTree } from "./components/SubagentTree.js";
import { PromptInput } from "./components/PromptInput.js";
import { AgentPanel } from "./components/AgentPanel.js";
import { AgentTranscript } from "./components/AgentTranscript.js";
import { THEMES, ThemeContext, type ThemeName } from "./theme.js";
import { useInputBuffer } from "./hooks/useInputBuffer.js";
import { useDialogQueue } from "./hooks/useDialogQueue.js";
import { useVim } from "./vim/useVim.js";
import { usePermissionQueue } from "./hooks/usePermissionQueue.js";
import { useTranscriptPager } from "./hooks/useTranscriptPager.js";
import type { HistoryEntry, AgentTask } from "./types.js";
import type { Skill } from "../skills.js";
import { buildRegistry } from "./commands/builtin/index.js";
import type { CommandSuggestion } from "./commands/registry.js";
import type { SlashCommand } from "./commands/types.js";
import { appendHistory, loadHistory, compactHistory } from "../promptHistory.js";

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
  "Ctrl+O opens the transcript pager",
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

function rebuildHistoryFromMessages(messages: MessageParam[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      const rawContent = msg.content as unknown;
      const content = typeof rawContent === "string"
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n")
          : "";
      if (content.trim()) entries.push({ type: "user", text: content });
    } else if (msg.role === "assistant") {
      const rawContent = msg.content as unknown;
      const content = typeof rawContent === "string"
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n")
          : "";
      if (content.trim()) entries.push({ type: "assistant", text: content });
    }
  }
  return entries;
}

export const App: React.FC<AppProps> = (props) => {
  const { exit } = useApp();
  const model = props.provider.getModel();
  const leaderTools = props.toolRegistry.getAll().length;
  const totalTools = props.totalToolCount ?? leaderTools;
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    const entries: HistoryEntry[] = [];
    if (props.bannerText) entries.push({ type: "banner", text: props.bannerText });
    if (props.initialSession?.messages) {
      entries.push(...rebuildHistoryFromMessages(props.initialSession.messages));
    }
    return entries;
  });
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
  const [viewingAgentId, setViewingAgentId] = useState<string | null>(null);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [atSuggestions, setAtSuggestions] = useState<AtSuggestion[]>([]);
  const [atSuggestionIndex, setAtSuggestionIndex] = useState(0);
  const [slashCmdIndex, setSlashCmdIndex] = useState(0);
  const [multiline, setMultiline] = useState<{ mode: "ticks" | "slash"; lines: string[] } | null>(null);
  const [pendingAgentPromptFor, setPendingAgentPromptFor] = useState<SubagentProfile | null>(null);
  const {
    focused: questionOverlay,
    enqueue: enqueueDialog,
    dismiss: dismissDialog,
    answer: answerDialog,
    setSelectedIndex: setOverlayIndex,
  } = useDialogQueue();
  const permQueue = usePermissionQueue();
  const [localJSX, setLocalJSX] = useState<React.ReactNode | null>(null);
  const [submittedPlaceholder, setSubmittedPlaceholder] = useState<string | null>(null);
  const { pushToBuffer, undo: undoBuffer, clearBuffer } = useInputBuffer();
  const transcriptPager = useTranscriptPager();
  const { vimState, handleVimInput, resetToInsert } = useVim();
  const [cursorOffset, setCursorOffset] = useState(0);

  const closeLocalJSX = useCallback((result?: string) => {
    setLocalJSX(null);
    if (result) setHistory(h => [...h, { type: "system", text: result }]);
  }, []);
  const messagesRef = useRef<MessageParam[]>(props.initialSession?.messages ?? []);
  const sessionIdRef = useRef(props.initialSession?.id ?? generateSessionId());
  const sessionCreatedAtRef = useRef(props.initialSession?.createdAt ?? new Date().toISOString());
  const sessionInitializedRef = useRef(Boolean(props.initialSession));
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
  const vimEnabled = useRef(false);
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
      props.executor.ctx.askUser = async (question: string, options: string[]) => {
        const isPermission =
          /\bAllow\b|\ballow\b|destructive|permission/i.test(question) ||
          options.some(o => /^Yes/i.test(o) || /^No/i.test(o));
        if (isPermission) {
          let kind: PermissionKind = "generic";
          let toolName = "Tool";
          let detail: string | undefined;
          let risk: "low" | "medium" | "high" = "medium";
          const bashMatch = question.match(/(?:Run|destructive command\??)[^\n]*\n([\s\S]+)/i);
          if (bashMatch || /\bcommand\b/i.test(question)) {
            kind = "bash";
            toolName = "bash";
            detail = bashMatch ? bashMatch[1].trim() : undefined;
            risk = /destructive/i.test(question) ? "high" : "medium";
          } else if (/\bwrite\b|\bedit\b/i.test(question)) {
            kind = "file_write";
            toolName = /\bedit\b/i.test(question) ? "edit_file" : "write_file";
            risk = "medium";
          } else if (/\bfetch\b|\bhttp\b|\burl\b/i.test(question)) {
            kind = "web_fetch";
            toolName = "web_fetch";
            risk = "low";
          }
          const { allowed } = await permQueue.request({
            kind,
            toolName,
            description: question,
            detail,
            risk,
          });
          const yes = options.find(o => /^Yes/i.test(o)) ?? options[0];
          const no = options.find(o => /^No/i.test(o)) ?? options[1] ?? "";
          return allowed ? yes : no;
        }
        return enqueueDialog({
          kind: "prompt",
          question,
          items: options.map(o => ({ label: o, value: o })),
          selectedIndex: 0,
        });
      };
    }
    return () => {
      if (props.executor.ctx) props.executor.ctx.askUser = undefined;
    };
  }, [props.executor, enqueueDialog, permQueue]);

  useEffect(() => {
    loadHistory({ project: process.cwd(), limit: 100 }).then(entries => {
      // Prepend persisted entries to in-memory history (oldest first)
      // Don't overwrite entries already added this session
      if (inputHistoryRef.current.length === 0) {
        inputHistoryRef.current = entries.map(e => e.display);
      }
    }).catch(() => {});
    compactHistory().catch(() => {});
  }, []);

  const allCommandNames = [...COMMANDS, ...(props.commands ?? []).map(c => c.name)];
  const subagentNames = ["atlas-swift", "atlas-forge", "atlas-deep", ...(props.subagents ?? []).map(s => s.name)];
  const completer = createCompleter({ commands: allCommandNames, subagentNames, cwd: process.cwd() });
  const suggestion = (() => {
    if (!input.startsWith("/")) return null;
    const [hits] = completer(input);
    return hits.find(h => h !== input) ?? null;
  })();

  // Slash command registry — built once, refreshed when custom commands change.
  // Tries registry first in handleCommand; legacy if-chain handles unmigrated.
  const registry = React.useMemo(
    () => buildRegistry(props.commands ?? []),
    [props.commands],
  );

  const slashCmds = (() => {
    if (!input.startsWith("/") || input.length < 1) return [] as CommandSuggestion[];
    const query = input.slice(1).split(/\s+/)[0] ?? "";
    const fromRegistry = registry.search(query, 8);
    const skillNames = new Set(fromRegistry.map(s => s.command.name));
    const skillSuggestions: CommandSuggestion[] = (props.skills ?? [])
      .filter(s => `/${s.name}`.startsWith(input) && !skillNames.has(s.name))
      .slice(0, Math.max(0, 8 - fromRegistry.length))
      .map(s => ({
        command: {
          kind: "prompt" as const,
          name: s.name,
          description: s.description ?? `Skill: ${s.name}`,
          source: "skill" as const,
          expand: async () => "",
        },
        score: 5,
      }));
    return [...fromRegistry, ...skillSuggestions].slice(0, 8);
  })();

  const commandArgumentHint = (() => {
    if (!input.startsWith("/")) return null;
    const parts = input.slice(1).split(/\s+/);
    const name = parts[0] ?? "";
    const hasSpace = input.includes(" ");
    if (!hasSpace) return null;
    const cmd = registry.find(name);
    return cmd?.argumentHint ?? null;
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
      title: generateSessionTitle(messagesRef.current),
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
    const userMessage: MessageParam = { role: "user", content };
    messagesRef.current.push(userMessage);
    if (!sessionInitializedRef.current) {
      const sessionFile = path.join(paths.sessions(), `${sessionIdRef.current}.jsonl`);
      if (!existsSync(sessionFile)) {
        await initSession(sessionIdRef.current, { model: props.provider.getModel(), title: generateSessionTitle(messagesRef.current) }).catch(() => {});
      }
      sessionInitializedRef.current = true;
    }
    await appendMessage(sessionIdRef.current, userMessage).catch(() => {});
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
              ? {
                  ...t,
                  toolUses: (t.toolUses ?? 0) + 1,
                  lastToolInfo: summary ? `${name}(${summary})` : name,
                  messages: [...(t.messages ?? []), { type: "tool_call", text: summary, toolName: name, nested: false }],
                }
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
        const cleanedText = finalText.replace(/\n$/, "");
        setHistory(h => [...h, { type: "assistant", text: cleanedText }]);
        setAgentTasks(tasks => {
          const last = [...tasks].reverse().find(t => t.status === "running");
          if (!last) return tasks;
          return tasks.map(t => t === last
            ? { ...t, messages: [...(t.messages ?? []), { type: "assistant", text: cleanedText }] }
            : t);
        });
      }
      setLiveTail("");
      setReasoningPreview("");
      await recordEvent({ sessionId: sessionIdRef.current, timestamp: new Date().toISOString(), type: "turn_complete", data: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, cachedTokens: (result as any).cachedTokens ?? 0 } });
      await runLifecycleHooks(props.hooks?.Stop ?? [], { ATLAS_SESSION_ID: sessionIdRef.current });
      const lastMessage = messagesRef.current[messagesRef.current.length - 1];
      if (lastMessage?.role === "assistant") {
        appendMessage(sessionIdRef.current, lastMessage).catch(() => {});
      }
      if (shouldCompact(messagesRef.current, DEFAULT_COMPACTION_CONFIG)) {
        const before = messagesRef.current.length;
        const result = await compactMessages({ messages: messagesRef.current, provider: props.provider, config: DEFAULT_COMPACTION_CONFIG });
        messagesRef.current = result.messages;
        addSystem(`[Compacted: ${before} → ${result.messages.length} messages · ${result.reInjected?.length ?? 0} files re-injected]\n\n${result.summary}`);
      }
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
    // Registry dispatch — try built-in/custom commands first.
    // Unmigrated commands fall through to the legacy if-chain below.
    const regName = value.slice(1).split(/\s+/)[0] ?? "";
    const regArgs = value.slice(1 + regName.length).trimStart();
    const registryCmd = registry.find(regName);
    if (registryCmd) {
      const ctx = {
        addSystem,
        args: regArgs,
        cwd: process.cwd(),
        setThemeName: (name: string) => setThemeName(name as ThemeName),
        setOutputStyle: (style: "default" | "compact" | "verbose") => setOutputStyle(style),
        app: {
          themeName,
          outputStyle,
          subagents: props.subagents ?? listSubagents(),
          enterPlanMode: () => { planModeRef.current.enter(); setPlanActive(true); },
          exitPlanMode: () => { planModeRef.current.exit(); setPlanActive(false); },
          tokens,
          mainModel: props.provider.getModel(),
          fastModel: fastModelRef.current ?? process.env["ATLAS_FAST_MODEL"] ?? props.provider.getModel(),
          reasoningModel: reasoningModelRef.current ?? process.env["ATLAS_REASONING_MODEL"] ?? props.provider.getModel(),
          mcpCount: props.mcpStatus?.filter(m => m.status === "connected").length ?? 0,
          permModeLabel: PERM_MODE_LABELS[permMode],
          planActive,
          leaderToolCount: props.toolRegistry.getAll().length,
          totalToolCount: props.totalToolCount ?? props.toolRegistry.getAll().length,
          skillCount: props.skills?.length ?? 0,
          subagentCount: (props.subagents ?? []).length,
          systemPromptLength: props.systemPrompt?.length ?? 0,
          messageCount: messagesRef.current.length,
          messagesJson: JSON.stringify(messagesRef.current),
          toolsJson: JSON.stringify(props.toolRegistry.getAll().map(t => ({ n: t.name, d: t.description, s: t.inputSchema }))),
          toolCount: props.toolRegistry.getAll().length,
          projectContextPath: props.projectContextPath,
          sessionId: sessionIdRef.current,
          tools: props.toolRegistry.getAll().map(t => ({ name: t.name })),
          mcpStatus: props.mcpStatus ?? [],
          skills: props.skills ?? [],
          messages: messagesRef.current,
          runPrompt: (text: string) => runPrompt(text),
          addHistory: (entry: HistoryEntry) => setHistory(h => [...h, entry]),
          executor: props.executor,
          providerGetModel: () => props.provider.getModel(),
          providerBaseUrl: (props.provider as any)._baseUrl,
          replStartCwd: replStartCwdRef.current,
          setModel: (tier: string, name: string) => {
            if (tier === "main") Object.assign(props.provider, props.provider.withModel(name));
            else if (tier === "fast") { fastModelRef.current = name; process.env["ATLAS_FAST_MODEL"] = name; }
            else { reasoningModelRef.current = name; process.env["ATLAS_REASONING_MODEL"] = name; }
          },
          saveSession: async () => {
            await saveSession(buildSession());
            return sessionIdRef.current;
          },
          loadSession: async (id: string) => {
            const session = await loadSession(id);
            if (!session) return `Session not found: ${id}`;
            messagesRef.current = session.messages;
            setHistory(rebuildHistoryFromMessages(session.messages));
            sessionIdRef.current = session.id;
            return `Loaded session ${id} (${session.messageCount} messages)`;
          },
          resumeSession: async () => {
            const sessions = await listSessions();
            if (!sessions.length) return "No saved sessions.";
            const items = sessions.slice(0, 10).map(s => {
              const date = s.updatedAt.slice(0, 10);
              const time = s.updatedAt.slice(11, 16);
              const ago = formatTimeAgo(s.updatedAt);
              const title = s.title ? `"${s.title}"` : s.id;
              return {
                label: title,
                sublabel: `${s.id} · ${date} ${time} (${ago}) · ${s.messageCount} msgs`,
                value: s.id,
              };
            });
            const chosenId = await enqueueDialog({
              kind: "prompt",
              question: "Resume which session?",
              items,
              selectedIndex: 0,
            });
            if (!chosenId) return "Resume cancelled.";
            const session = await loadSession(chosenId);
            if (!session) return `Session not found: ${chosenId}`;
            messagesRef.current = session.messages;
            setHistory(rebuildHistoryFromMessages(session.messages));
            sessionIdRef.current = session.id;
            return `Resumed session ${chosenId} (${session.messageCount} messages)`;
          },
          compact: async () => {
            const before = messagesRef.current.length;
            if (before === 0) return "Nothing to compact.";
            try {
              const result = await compactMessages({
                messages: messagesRef.current,
                provider: props.provider,
                config: DEFAULT_COMPACTION_CONFIG,
              });
              messagesRef.current = result.messages;
              const sessions = await import("../sessions.js");
              if ("appendCompactBoundary" in sessions) {
                await (sessions as any).appendCompactBoundary(sessionIdRef.current, {
                  preCompactCount: result.preCompactCount,
                  summary: result.summary,
                }).catch(() => {});
              }
              setHistory(h => [...h, {
                type: "compact_boundary",
                text: `${result.preCompactCount} → ${result.messages.length} msgs · ${result.reInjected?.length ?? 0} files re-injected`,
              }]);
              return `Compacted ${before} → ${result.messages.length} messages.\n\n## Summary\n\n${result.summary}`;
            } catch (err) {
              return `Compact failed: ${err instanceof Error ? err.message : String(err)}`;
            }
          },
          runAgent: async (name: string, prompt: string) => {
            const agents = props.subagents ?? listSubagents();
            const profile = agents.find(a => a.name === name);
            if (!profile) return `Agent not found: ${name}`;
            await runPrompt(prompt, {
              registry: filterRegistryForSubagent(props.toolRegistry, profile),
              provider: profile.model ? props.provider.withModel(profile.model) : props.fastModel ? props.provider.withModel(props.fastModel) : props.provider,
              systemPrompt: profile.systemPrompt,
            });
            return "";
          },
          setPendingAgent: (name: string) => {
            const agents = props.subagents ?? listSubagents();
            const profile = agents.find(a => a.name === name);
            if (profile) setPendingAgentPromptFor(profile);
          },
        },
      };
      if (registryCmd.kind === "local") {
        const result = await registryCmd.call(ctx);
        if (result.type === "text") { addSystem(result.value); return true; }
        if (result.type === "exit") { exit(); return true; }
        if (result.type === "clear") {
          messagesRef.current = [];
          setHistory([]);
          setTokens({ input: 0, output: 0, cached: 0 });
          setLiveTokens(0);
          addSystem("Conversation cleared.");
          return true;
        }
        if (result.type === "skip") return true;
        if (result.type === "submit") {
          await handleSubmitRef.current(result.value);
          return true;
        }
        return true;
      }
      if (registryCmd.kind === "prompt") {
        const expanded = await registryCmd.expand(regArgs, ctx);
        if (expanded.trim()) await runPrompt(expanded);
        return true;
      }
      if (registryCmd.kind === "local-jsx") {
        const node = await registryCmd.render(ctx, closeLocalJSX);
        setLocalJSX(node ?? null);
        return true;
      }
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
    if (vimEnabled.current) resetToInsert();
    setCursorOffset(0);
    // Expand [paste #N: M lines] placeholders back to their full content
    const expanded = value.replace(/\[paste #(\d+): \d+ lines?\]/g, (_, id) => {
      return pasteRefsRef.current.get(id) ?? _;
    });
    const trimmed = expanded.trim();
    setSubmittedPlaceholder(trimmed);
    setInput("");
    clearBuffer();
    if (trimmed && (inputHistoryRef.current.length === 0 || inputHistoryRef.current[inputHistoryRef.current.length - 1] !== trimmed)) {
      inputHistoryRef.current.push(trimmed);
    }
    historyIndexRef.current = -1;
    // Persist to disk (skip slash commands)
    if (!trimmed.startsWith("/")) {
      appendHistory({
        display: trimmed,
        timestamp: new Date().toISOString(),
        project: process.cwd(),
        sessionId: sessionIdRef.current,
      }).catch(() => {});
    }

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
    if (isRunning) setSubmittedPlaceholder(null);
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning && queuedMessageRef.current) {
      const msg = queuedMessageRef.current;
      queuedMessageRef.current = null;
      setQueuedMessage(null);
      handleSubmitRef.current(msg);
    }
  }, [isRunning]);

  useEffect(() => {
    import("../config.js").then(({ loadConfig }) => {
      try {
        vimEnabled.current = loadConfig().editorMode === "vim";
      } catch {}
    }).catch(() => {});
  }, []);

  useInput((inputChar, key) => {
    if (questionOverlay) {
      if (key.upArrow) {
        setOverlayIndex(Math.max(0, questionOverlay.selectedIndex - 1));
        return;
      }
      if (key.downArrow) {
        setOverlayIndex(Math.min(questionOverlay.items.length - 1, questionOverlay.selectedIndex + 1));
        return;
      }
      if (key.return) {
        answerDialog(questionOverlay.items[questionOverlay.selectedIndex].value);
        return;
      }
      if (key.escape) {
        dismissDialog();
        return;
      }
      if (inputChar >= "1" && inputChar <= "4") {
        const idx = parseInt(inputChar) - 1;
        if (idx < questionOverlay.items.length) {
          answerDialog(questionOverlay.items[idx].value);
          return;
        }
      }
      return;
    }

    if (key.ctrl && inputChar === "o") {
      if (transcriptPager.isOpen) {
        transcriptPager.close();
      } else {
        transcriptPager.open(history.length);
      }
      return;
    }

    if (key.ctrl && inputChar === "t") {
      if (agentTasks.length > 0) {
        setAgentPanelOpen(p => !p);
      }
      return;
    }

    if (key.leftArrow && viewingAgentId) {
      setViewingAgentId(null);
      return;
    }

    // Ctrl+Z — undo input buffer first, then file-level undo
    if (key.ctrl && inputChar === "z") {
      const prev = undoBuffer();
      if (prev) {
        setInput(prev.text);
        setCursorOffset(prev.text.length);
        return;
      }
      handleSubmit("/undo");
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
      if (ctrlCPressedAtRef.current && now - ctrlCPressedAtRef.current < 3000) {
        // Auto-save session before exit so user can --resume
        saveSession(buildSession()).catch(() => {});
        exit();
      } else {
        ctrlCPressedAtRef.current = now;
        addSystem(`(Press Ctrl+C again to exit · session: ${sessionIdRef.current})`);
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

    if (vimEnabled.current) {
      const result = handleVimInput(inputChar, key, input, cursorOffset);
      if (result.text !== input) setInput(result.text);
      if (result.offset !== cursorOffset) setCursorOffset(result.offset);
      if (result.consumed) return;
    }

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
        const selected = slashCmds[slashCmdIndex];
        if (selected) setInput("/" + selected.command.name + " ");
        setSlashCmdIndex(0);
        return;
      }
      if (atSuggestions.length > 0) {
        const chosen = atSuggestions[atSuggestionIndex].path;
        const newVal = input.replace(/@([\w./\-]*)$/, `@${chosen}`);
        setInput(newVal);
        setCursorOffset(newVal.length);
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
        if (chosen) handleSubmit("/" + chosen.command.name);
        return;
      }
      const value = input;
      setInput("");
      setCursorOffset(0);
      setSlashCmdIndex(0);
      setAtSuggestions([]);
      if (value.trim()) handleSubmit(value);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (cursorOffset <= 0) return;
      const newInput = input.slice(0, cursorOffset - 1) + input.slice(cursorOffset);
      const newOffset = cursorOffset - 1;
      setInput(newInput);
      setCursorOffset(newOffset);
      pushToBuffer(newInput, newOffset);
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
        setCursorOffset(newInput.length);
        setSlashCmdIndex(0);
        return;
      }
      // Use a functional updater so this runs AFTER any in-flight setInput
      // (e.g. a backspace event from the same tick when an IME splits a
      // chunk into DEL + composed char). Reading `input` from closure here
      // would clobber the backspace and leave "Baây" instead of "Bây".
      const newInput = input.slice(0, cursorOffset) + inputChar + input.slice(cursorOffset);
      setInput(newInput);
      setCursorOffset(cursorOffset + inputChar.length);
      pushToBuffer(newInput, cursorOffset + inputChar.length);
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
        {transcriptPager.isOpen ? (
          <TranscriptPager
            history={history}
            frozenCount={transcriptPager.frozenCount}
            searchQuery={transcriptPager.searchQuery}
            searchOpen={transcriptPager.searchOpen}
            dumpMode={transcriptPager.dumpMode}
            outputStyle={outputStyle}
            onClose={transcriptPager.close}
            onOpenSearch={transcriptPager.openSearch}
            onCloseSearch={transcriptPager.closeSearch}
            onDumpMode={transcriptPager.enableDumpMode}
          />
        ) : (
          <>
            {!viewingAgentId && <MessageList history={history} outputStyle={outputStyle} />}
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
            {permQueue.pending && (
              <PermissionRequest
                kind={permQueue.pending.kind}
                toolName={permQueue.pending.toolName}
                description={permQueue.pending.description}
                detail={permQueue.pending.detail}
                risk={permQueue.pending.risk}
                onAllow={permQueue.allow}
                onDeny={permQueue.deny}
                onAllowAlways={permQueue.allowAlways}
              />
            )}
            <QuestionOverlay overlay={questionOverlay} width={overlayWidth} />
            {liveTail && (
              <Box>
                <Text>{liveTail}</Text>
              </Box>
            )}
            {submittedPlaceholder && !isRunning && (
              <Box marginTop={1}>
                <Text color={theme.user} bold>{"> "}</Text>
                <Text bold>{submittedPlaceholder}</Text>
              </Box>
            )}
            {agentPanelOpen && agentTasks.length > 0 && (
              <AgentPanel
                tasks={agentTasks}
                selectedId={viewingAgentId}
                onSelect={id => setViewingAgentId(id)}
                onClose={() => setAgentPanelOpen(false)}
                width={fullWidth}
              />
            )}
            {viewingAgentId && (() => {
              const task = agentTasks.find(t => t.id === viewingAgentId);
              return task ? (
                <AgentTranscript task={task} outputStyle={outputStyle} />
              ) : null;
            })()}
            {!viewingAgentId && isRunning && <SubagentTree tasks={agentTasks} />}
            {isRunning && (
              <SpinnerLine
                spinFrame={spinFrame}
                spinFrames={SPIN_FRAMES}
                statusVerb={statusVerb}
                elapsedSecs={elapsedSecs}
                liveTokens={liveTokens}
                currentToolName={currentToolName}
                tip={tip}
              />
            )}
            {localJSX}
            <PromptInput
              fullWidth={fullWidth}
              gitBranch={gitBranch}
              planActive={planActive}
              multiline={multiline}
              input={input}
              slashCmds={slashCmds}
              slashCmdIndex={slashCmdIndex}
              commandArgumentHint={commandArgumentHint}
              atSuggestions={atSuggestions}
              atSuggestionIndex={atSuggestionIndex}
              permMode={permMode}
              permModeLabels={PERM_MODE_LABELS}
              tokens={tokens}
              modelName={props.provider.getModel()}
              isRunning={isRunning}
              queuedMessage={queuedMessage}
              vimMode={vimState.mode}
              hasAgents={agentTasks.length > 0}
            />
          </>
        )}
      </Box>
    </ThemeContext.Provider>
  );
};
