import OpenAI from "openai";
import type { ProviderConfig, Message, ToolDef, StreamDelta } from "./types.js";

export function isStaleConnectionError(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  const code = e?.code ?? e?.cause?.code;
  if (code === "ECONNRESET" || code === "EPIPE") return true;
  const msg = (e?.message ?? "").toLowerCase();
  return msg.includes("econnreset") || msg.includes("socket hang up") || msg.includes("epipe");
}

export function parseContextOverflow(err: unknown): { inputTokens: number; contextLimit: number } | null {
  const e = err as { status?: number; message?: string };
  if (e?.status !== 400 || !e?.message) return null;
  const msg = e.message;
  if (!/context|max_tokens|too long|exceed/i.test(msg)) return null;
  const numbers = msg.match(/\d{4,}/g);
  if (!numbers || numbers.length < 2) return null;
  const inputTokens = parseInt(numbers[0], 10);
  const contextLimit = parseInt(numbers[1], 10);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(contextLimit)) return null;
  return { inputTokens, contextLimit };
}

export class OpenAIProvider {
  private client: OpenAI;
  private model: string;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.model = config.model;
  }

  withModel(model: string): OpenAIProvider {
    return new OpenAIProvider({ ...this.config, model });
  }

  getModel(): string {
    return this.model;
  }

  private recreateClient(): void {
    this.client = new OpenAI({ apiKey: this.config.apiKey, baseURL: this.config.baseURL });
  }

  private async createChatCompletion<T extends OpenAI.ChatCompletionCreateParams>(params: T): Promise<T extends { stream: true } ? AsyncIterable<OpenAI.ChatCompletionChunk> : OpenAI.ChatCompletion> {
    try {
      return await (this.client.chat.completions.create(params) as Promise<unknown>) as never;
    } catch (err) {
      if (isStaleConnectionError(err)) {
        console.error("[atlas] Stale connection — recreating client and retrying once");
        this.recreateClient();
        return await (this.client.chat.completions.create(params) as Promise<unknown>) as never;
      }
      const overflow = parseContextOverflow(err);
      if (overflow) {
        const safety = 1000;
        const newMax = Math.max(512, overflow.contextLimit - overflow.inputTokens - safety);
        const currentMax = (params.max_tokens ?? 8192) as number;
        if (newMax < currentMax) {
          console.error(`[atlas] Context overflow: reducing max_tokens ${currentMax} → ${newMax}`);
          return await (this.client.chat.completions.create({ ...params, max_tokens: newMax }) as Promise<unknown>) as never;
        }
      }
      throw err;
    }
  }

  async *stream(messages: Message[], tools: ToolDef[], systemPrompt?: string): AsyncGenerator<StreamDelta> {
    const msgs: OpenAI.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      msgs.push({ role: "system", content: systemPrompt });
    }

    for (const m of messages) {
      if (m.role === "system") {
        msgs.push({ role: "system", content: m.content ?? "" });
      } else if (m.role === "tool") {
        msgs.push({ role: "tool", content: m.content ?? "", tool_call_id: m.tool_call_id! });
      } else if (m.role === "assistant" && m.tool_calls) {
        msgs.push({
          role: "assistant",
          content: m.content ?? null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        });
      } else {
        msgs.push({ role: m.role as "user" | "assistant", content: m.content ?? "" });
      }
    }

    const openaiTools: OpenAI.ChatCompletionTool[] = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters as Record<string, unknown>,
      },
    }));

    const stream = await this.createChatCompletion({
      model: this.model,
      messages: msgs,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      stream: true,
      max_tokens: 8192,
    });

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta;

      if (delta.content) {
        yield { type: "text", text: delta.content };
      }

      // Reasoning content (gpt-5-thinking, deepseek-r1, claude via Databricks)
      if ((delta as any).reasoning_content) {
        yield { type: "reasoning", text: (delta as any).reasoning_content };
      }
      if ((delta as any).reasoning) {
        yield { type: "reasoning", text: (delta as any).reasoning };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.function?.name) {
            yield {
              type: "tool_call_start",
              toolCallId: tc.id ?? "",
              toolCallName: tc.function.name,
              argumentsDelta: tc.function.arguments ?? "",
            };
          } else if (tc.function?.arguments) {
            yield {
              type: "tool_call_delta",
              toolCallId: tc.id ?? "",
              argumentsDelta: tc.function.arguments,
            };
          }
        }
      }

      if (choice.finish_reason) {
        yield { type: "done" };
      }
    }
  }

  async complete(messages: Message[], systemPrompt?: string): Promise<string> {
    const msgs: OpenAI.ChatCompletionMessageParam[] = [];
    if (systemPrompt) {
      msgs.push({ role: "system", content: systemPrompt });
    }
    for (const m of messages) {
      msgs.push({ role: m.role as "user" | "assistant", content: m.content ?? "" });
    }

    const response = await this.createChatCompletion({
      model: this.model,
      messages: msgs,
      max_tokens: 2048,
    });

    return response.choices[0]?.message?.content ?? "";
  }
}

export { OpenAIProvider as AnthropicProvider };
