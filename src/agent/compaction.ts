import type { MessageParam } from "../provider/types.js";
import type { OpenAIProvider } from "../provider/openai.js";
import { getRecentReads } from "../utils/readFileState.js";

export interface CompactionConfig {
  maxTokenEstimate: number;
  keepRecentMessages: number;
  contextWindow?: number;      // model context window size
  outputReserve?: number;      // tokens reserved for the summary/response
}

export interface CompactResult {
  messages: MessageParam[];
  summary: string;
  preCompactCount: number;
  reInjected?: { path: string; bytes: number }[];
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  maxTokenEstimate: 80000,
  keepRecentMessages: 6,
  contextWindow: 200000,
  outputReserve: 20000,
};

const SUMMARIZATION_PROMPT = `You are summarizing a coding assistant conversation to preserve context across a context window reset.

Produce a structured summary with these exact sections:

## What was accomplished
- Bullet list of completed tasks, fixes, features implemented

## Current state
- What the user is currently working on
- Where things stand right now

## Files modified
- List of files that were created, edited, or deleted (with brief note on what changed)

## Key decisions & context
- Architecture decisions made
- Important constraints or requirements discovered
- Anything the assistant should remember going forward

## Pending / next steps
- Unfinished tasks
- Things the user mentioned wanting to do next

Be specific and concrete. Include file paths, function names, error messages where relevant. This summary will replace the conversation history — the assistant must be able to continue work from this summary alone.`;

export function estimateTokens(messages: MessageParam[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    }
    if (msg.tool_calls) {
      chars += JSON.stringify(msg.tool_calls).length;
    }
  }
  return Math.ceil(chars / 4);
}

export function shouldCompact(messages: MessageParam[], config: CompactionConfig): boolean {
  // Effective threshold = context window − output reserve, capped by the
  // explicit maxTokenEstimate (whichever is lower). This way the agent loop
  // compacts BEFORE the API rejects with prompt-too-long, leaving headroom
  // for the response. Mirrors cc-ref autoCompact.ts:33.
  const reserveBased = config.contextWindow && config.outputReserve
    ? config.contextWindow - config.outputReserve
    : Infinity;
  const threshold = Math.min(config.maxTokenEstimate, reserveBased);
  return estimateTokens(messages) > threshold;
}

export async function compactMessages(params: {
  messages: MessageParam[];
  provider: OpenAIProvider;
  config: CompactionConfig;
}): Promise<CompactResult> {
  const { messages, provider, config } = params;

  if (messages.length <= config.keepRecentMessages) {
    return { messages, summary: "", preCompactCount: messages.length };
  }

  const preCompactCount = messages.length;
  const splitIndex = messages.length - config.keepRecentMessages;
  const toSummarize = messages.slice(0, splitIndex);
  const toKeep = messages.slice(splitIndex);

  const summarizeMessages: MessageParam[] = [
    {
      role: "user",
      content: toSummarize
        .map((m) => {
          const content = typeof m.content === "string"
            ? m.content
            : JSON.stringify(m.content);
          return `[${m.role}]: ${content}`;
        })
        .join("\n\n"),
    },
  ];

  const summary = await provider.complete(summarizeMessages, SUMMARIZATION_PROMPT);

  // Re-inject up to 5 recently-read files within token budget so the agent
  // doesn't lose code context after compaction. Mirrors cc-ref behaviour.
  const RE_INJECT_BUDGET = 50_000;
  const PER_FILE_LIMIT = 5_000;
  const recentReads = getRecentReads().slice(0, 5);

  const reInjected: { path: string; bytes: number }[] = [];
  let budget = RE_INJECT_BUDGET;
  const reInjectMessages: MessageParam[] = [];

  for (const r of recentReads) {
    const fileTokens = Math.min(PER_FILE_LIMIT, Math.ceil(r.content.length / 4));
    if (budget - fileTokens < 0) break;
    budget -= fileTokens;
    const maxChars = PER_FILE_LIMIT * 4;
    const content = r.content.length > maxChars
      ? r.content.slice(0, maxChars) + `\n\n[truncated — ${r.content.length - maxChars} more chars]`
      : r.content;
    reInjectMessages.push({
      role: "user",
      content: `[Re-injected after compact: ${r.path}]\n\n\`\`\`\n${content}\n\`\`\``,
    });
    reInjected.push({ path: r.path, bytes: r.content.length });
  }

  const finalMessages: MessageParam[] = [
    { role: "user", content: `[Compacted summary of ${preCompactCount} earlier messages]\n\n${summary}` },
    ...reInjectMessages,
    ...toKeep,
  ];

  return { messages: finalMessages, summary, preCompactCount, reInjected };
}
