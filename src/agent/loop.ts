import type { MessageParam } from "../provider/types.js";
import type { AnthropicProvider } from "../provider/anthropic.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolExecutor } from "../tools/executor.js";

export interface LoopResult {
  inputTokens: number;
  outputTokens: number;
}

export async function runAgentLoop(params: {
  provider: AnthropicProvider;
  messages: MessageParam[];
  toolRegistry: ToolRegistry;
  executor: ToolExecutor;
  systemPrompt?: string;
  abortSignal: AbortSignal;
}): Promise<LoopResult> {
  const { provider, messages, toolRegistry, executor, systemPrompt, abortSignal } = params;
  const tools = toolRegistry.toAnthropicTools();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  while (!abortSignal.aborted) {
    const stream = provider.stream(messages, tools, systemPrompt);

    const accumulator = new Map<number, { id: string; name: string; json: string }>();
    const toolUseBlocks: Array<{ id: string; name: string; input: unknown }> = [];

    for await (const event of stream) {
      if (abortSignal.aborted) break;

      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "tool_use") {
          accumulator.set(event.index, { id: block.id, name: block.name, json: "" });
        }
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          process.stdout.write(delta.text);
        } else if (delta.type === "input_json_delta") {
          const entry = accumulator.get(event.index);
          if (entry) {
            entry.json += delta.partial_json;
          }
        }
      } else if (event.type === "content_block_stop") {
        const entry = accumulator.get(event.index);
        if (entry) {
          const input = entry.json ? JSON.parse(entry.json) : {};
          toolUseBlocks.push({ id: entry.id, name: entry.name, input });
          accumulator.delete(event.index);
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    if (finalMessage.usage) {
      totalInputTokens += finalMessage.usage.input_tokens ?? 0;
      totalOutputTokens += finalMessage.usage.output_tokens ?? 0;
    }
    messages.push({ role: "assistant", content: finalMessage.content });

    if (toolUseBlocks.length === 0) {
      return { inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
    }

    const results = await executor.execute(toolUseBlocks);

    messages.push({
      role: "user",
      content: results.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.toolUseId,
        content: r.content,
        is_error: r.isError,
      })),
    });
  }

  return { inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}
