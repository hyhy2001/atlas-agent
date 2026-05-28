import OpenAI from "openai";
import type { ProviderConfig, Message, ToolDef, StreamDelta } from "./types.js";

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

    const stream = await this.client.chat.completions.create({
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

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: msgs,
      max_tokens: 2048,
    });

    return response.choices[0]?.message?.content ?? "";
  }
}

export { OpenAIProvider as AnthropicProvider };
