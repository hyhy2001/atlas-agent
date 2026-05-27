import Anthropic from "@anthropic-ai/sdk";
import type { ProviderConfig, MessageParam, Tool } from "./types.js";

export class AnthropicProvider {
  private client: Anthropic;
  private model: string;

  constructor(config: ProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.model = config.model;
  }

  stream(messages: MessageParam[], tools: Tool[], systemPrompt?: string) {
    return this.client.messages.stream({
      model: this.model,
      max_tokens: 8192,
      messages,
      tools,
      ...(systemPrompt ? { system: systemPrompt } : {}),
    });
  }

  async complete(messages: MessageParam[], systemPrompt?: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages,
    });
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.text ?? "";
  }

  getModel(): string {
    return this.model;
  }
}
