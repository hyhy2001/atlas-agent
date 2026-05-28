import type { MessageParam, ToolCall } from "../provider/types.js";
import type { OpenAIProvider } from "../provider/openai.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolExecutor } from "../tools/executor.js";
import { MarkdownRenderer } from "../markdown.js";

export interface LoopResult {
  inputTokens: number;
  outputTokens: number;
}

export async function runAgentLoop(params: {
  provider: OpenAIProvider;
  messages: MessageParam[];
  toolRegistry: ToolRegistry;
  executor: ToolExecutor;
  systemPrompt?: string;
  abortSignal: AbortSignal;
}): Promise<LoopResult> {
  const { provider, messages, toolRegistry, executor, systemPrompt, abortSignal } = params;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  while (true) {
    if (abortSignal.aborted) return { inputTokens: totalInputTokens, outputTokens: totalOutputTokens };

    const tools = toolRegistry.toOpenAITools();
    const toolCalls: ToolCall[] = [];
    let currentToolCall: { id: string; name: string; args: string } | null = null;
    let assistantContent = "";
    const renderer = new MarkdownRenderer();

    for await (const delta of provider.stream(messages, tools, systemPrompt)) {
      if (abortSignal.aborted) break;

      if (delta.type === "text" && delta.text) {
        const rendered = renderer.write(delta.text);
        if (rendered) process.stdout.write(rendered);
        assistantContent += delta.text;
      } else if (delta.type === "tool_call_start") {
        if (currentToolCall) {
          toolCalls.push({
            id: currentToolCall.id,
            type: "function",
            function: { name: currentToolCall.name, arguments: currentToolCall.args },
          });
        }
        currentToolCall = {
          id: delta.toolCallId ?? "",
          name: delta.toolCallName ?? "",
          args: delta.argumentsDelta ?? "",
        };
      } else if (delta.type === "tool_call_delta") {
        if (currentToolCall) {
          currentToolCall.args += delta.argumentsDelta ?? "";
        }
      } else if (delta.type === "done") {
        if (currentToolCall) {
          toolCalls.push({
            id: currentToolCall.id,
            type: "function",
            function: { name: currentToolCall.name, arguments: currentToolCall.args },
          });
          currentToolCall = null;
        }
      }
    }

    const flushed = renderer.flush();
    if (flushed) process.stdout.write(flushed);

    totalInputTokens += Math.ceil(JSON.stringify(messages).length / 4);
    totalOutputTokens += Math.ceil((assistantContent.length + JSON.stringify(toolCalls).length) / 4);

    const assistantMsg: MessageParam = {
      role: "assistant",
      content: assistantContent || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
    messages.push(assistantMsg);

    if (toolCalls.length === 0) break;

    const toolBlocks = toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments || "{}"),
    }));

    const results = await executor.execute(toolBlocks);

    for (const result of results) {
      messages.push({
        role: "tool",
        content: result.content,
        tool_call_id: result.toolUseId,
      });
    }
  }

  return { inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}
