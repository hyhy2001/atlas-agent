import type { MessageParam } from "../provider/types.js";
import type { AnthropicProvider } from "../provider/anthropic.js";

export interface CompactionConfig {
  maxTokenEstimate: number;
  keepRecentMessages: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  maxTokenEstimate: 80000,
  keepRecentMessages: 10,
};

const SUMMARIZATION_PROMPT = `Summarize this conversation concisely. Include:
- Key decisions made
- Files that were read or modified
- Current state of the task
- Any pending items or blockers

Be brief but preserve critical context. Output only the summary, no preamble.`;

export function estimateTokens(messages: MessageParam[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if ("text" in block && typeof block.text === "string") {
          chars += block.text.length;
        } else if ("content" in block) {
          chars += typeof block.content === "string"
            ? block.content.length
            : JSON.stringify(block.content).length;
        } else {
          chars += JSON.stringify(block).length;
        }
      }
    }
  }
  return Math.ceil(chars / 4);
}

export function shouldCompact(messages: MessageParam[], config: CompactionConfig): boolean {
  return estimateTokens(messages) > config.maxTokenEstimate;
}

export async function compactMessages(params: {
  messages: MessageParam[];
  provider: AnthropicProvider;
  config: CompactionConfig;
}): Promise<MessageParam[]> {
  const { messages, provider, config } = params;

  if (messages.length <= config.keepRecentMessages) {
    return messages;
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

  return [
    { role: "user", content: `[Conversation summary]\n\n${summary}` },
    ...toKeep,
  ];
}
