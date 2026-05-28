import type { OpenAIProvider } from "./provider/openai.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { ToolExecutor } from "./tools/executor.js";
import type { PermissionSession } from "./permissions/session.js";
import type { Session } from "./sessions.js";
import { generateSessionId, saveSession } from "./sessions.js";
import { runAgentLoop } from "./agent/loop.js";
import type { MessageParam } from "./provider/types.js";

interface CollectedToolCall {
  name: string;
  input: unknown;
  result: string;
}

export async function runHeadless(params: {
  prompt: string;
  provider: OpenAIProvider;
  toolRegistry: ToolRegistry;
  executor: ToolExecutor;
  permissions: PermissionSession;
  systemPrompt?: string;
  initialSession?: Session;
  autoApprove?: boolean;
  json?: boolean;
}): Promise<void> {
  const {
    prompt,
    provider,
    toolRegistry,
    executor,
    permissions,
    systemPrompt,
    initialSession,
    autoApprove,
    json,
  } = params;

  if (autoApprove) {
    permissions.grant("bash");
    permissions.grant("write_file");
    permissions.grant("edit_file");
  }

  const messages: MessageParam[] = initialSession?.messages ?? [];
  const sessionId = initialSession?.id ?? generateSessionId();
  const createdAt = initialSession?.createdAt ?? new Date().toISOString();
  const model = provider.getModel();
  const toolCalls: CollectedToolCall[] = [];
  const controller = new AbortController();

  messages.push({ role: "user", content: prompt });

  const originalWrite = process.stdout.write.bind(process.stdout);
  let collectedOutput = "";

  const wrappedExecutor = {
    execute: async (blocks: Array<{ id: string; name: string; input: unknown }>) => {
      const results = await executor.execute(blocks);
      for (const block of blocks) {
        const result = results.find((r) => r.toolUseId === block.id);
        toolCalls.push({
          name: block.name,
          input: block.input,
          result: result?.content ?? "",
        });
      }
      return results;
    },
  } as ToolExecutor;

  if (json) {
    process.stdout.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((err?: Error) => void), cb?: (err?: Error) => void) => {
      collectedOutput += typeof chunk === "string" ? chunk : chunk.toString();
      if (typeof encoding === "function") {
        encoding();
      } else if (cb) {
        cb();
      }
      return true;
    }) as typeof process.stdout.write;
  }

  try {
    await runAgentLoop({
      provider,
      messages,
      toolRegistry,
      executor: wrappedExecutor,
      systemPrompt,
      abortSignal: controller.signal,
    });
  } finally {
    if (json) {
      process.stdout.write = originalWrite as typeof process.stdout.write;
    }
  }

  const session: Session = {
    id: sessionId,
    createdAt,
    updatedAt: new Date().toISOString(),
    model,
    messageCount: messages.length,
    messages,
  };
  await saveSession(session);

  if (json) {
    console.log(JSON.stringify({
      response: collectedOutput,
      toolCalls,
      model,
      sessionId,
    }));
  }
}
