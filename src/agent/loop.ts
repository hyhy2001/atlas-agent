import type { MessageParam, ToolCall } from "../provider/types.js";
import type { OpenAIProvider } from "../provider/openai.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolExecutor } from "../tools/executor.js";
import { MarkdownRenderer } from "../markdown.js";
import { estimateTokens } from "../utils/tokenEstimation.js";
import { offloadIfLarge } from "../utils/toolResultStorage.js";
import { getCachedTools } from "../utils/toolSchemaCache.js";

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
  onText?: (text: string) => void;
  onTokens?: (deltaTokens: number) => void;
  onReasoning?: (text: string) => void;
}): Promise<LoopResult> {
  const { provider, messages, toolRegistry, executor, systemPrompt, abortSignal, onText, onTokens, onReasoning } = params;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  while (true) {
    if (abortSignal.aborted) return { inputTokens: totalInputTokens, outputTokens: totalOutputTokens };

    const tools = getCachedTools(toolRegistry.toOpenAITools());
    const toolCalls: ToolCall[] = [];
    let currentToolCall: { id: string; name: string; args: string } | null = null;
    let assistantContent = "";
    const renderer = new MarkdownRenderer();

    for await (const delta of provider.stream(messages, tools, systemPrompt)) {
      if (abortSignal.aborted) break;

      if (delta.type === "text" && delta.text) {
        const rendered = renderer.write(delta.text);
        if (rendered) {
          if (onText) onText(rendered);
          else process.stdout.write(rendered);
        }
        assistantContent += delta.text;
        if (onTokens) onTokens(Math.ceil(delta.text.length / 4));
      } else if (delta.type === "reasoning" && delta.text) {
        if (onReasoning) onReasoning(delta.text);
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
    if (flushed) {
      if (onText) onText(flushed);
      else process.stdout.write(flushed);
    }

    // Estimate input tokens: messages + system prompt + tool schemas.
    // Previously only messages were counted, causing the TUI to show ~13↑
    // even with a 2000-token system prompt.
    const toolsJson = JSON.stringify(tools);
    totalInputTokens += estimateTokens(JSON.stringify(messages))
      + estimateTokens(systemPrompt ?? "")
      + estimateTokens(toolsJson);
    totalOutputTokens += estimateTokens(assistantContent + JSON.stringify(toolCalls));

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
      const content = await offloadIfLarge(result.toolUseId, result.content);
      messages.push({
        role: "tool",
        content,
        tool_call_id: result.toolUseId,
      });
    }
  }

  return { inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}
