import type { MessageParam } from "../provider/types.js";
import type { OpenAIProvider } from "../provider/openai.js";

export interface CompactionConfig {
  maxTokenEstimate: number;
  keepRecentMessages: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  maxTokenEstimate: 80000,
  keepRecentMessages: 6,
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
  return estimateTokens(messages) > config.maxTokenEstimate;
}

export async function compactMessages(params: {
  messages: MessageParam[];
  provider: OpenAIProvider;
  config: CompactionConfig;
}): Promise<{ messages: MessageParam[]; summary: string }> {
  const { messages, provider, config } = params;

  if (messages.length <= config.keepRecentMessages) {
    return { messages, summary: "" };
  }

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

  return {
    messages: [
      { role: "user", content: `[Previous conversation summary — read this to understand context]\n\n${summary}` },
      ...toKeep,
    ],
    summary,
  };
}
