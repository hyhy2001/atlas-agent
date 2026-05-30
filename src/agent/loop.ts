import type { MessageParam, ToolCall } from "../provider/types.js";
import type { OpenAIProvider } from "../provider/openai.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolExecutor } from "../tools/executor.js";
import { MarkdownRenderer } from "../markdown.js";
import { estimateTokens } from "../utils/tokenEstimation.js";
import { offloadIfLarge, applyToolResultBudget } from "../utils/toolResultStorage.js";
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

  // Count system prompt + tool schemas once per loop entry — they don't
  // change across turns within a single user request.
  const systemTokens = estimateTokens(systemPrompt ?? "");
  const toolsJson = JSON.stringify(getCachedTools(toolRegistry.toOpenAITools()));
  const toolSchemaTokens = estimateTokens(toolsJson);

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

    // Input for THIS request = system prompt + tool schemas (constant per
    // loop entry) + full message history sent this turn. This matches what
    // the API actually receives as prompt_tokens each round-trip.
    const currentMessagesTokens = estimateTokens(JSON.stringify(messages));
    totalInputTokens += systemTokens + toolSchemaTokens + currentMessagesTokens;
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

    // 1. Offload oversized results to disk (middle-cut preview).
    const offloaded = await Promise.all(
      results.map(r => offloadIfLarge(r.toolUseId, r.content))
    );
    // 2. Apply per-message aggregate cap — clear oldest results if the
    //    combined size still blows the budget after offload.
    const budgeted = applyToolResultBudget(offloaded);
    for (let i = 0; i < results.length; i++) {
      messages.push({
        role: "tool",
        content: budgeted[i],
        tool_call_id: results[i].toolUseId,
      });
    }
  }

  return { inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}
