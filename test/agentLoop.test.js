import { describe, it, expect } from 'vitest';
import { runAgentLoop } from '../src/agent/loop.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolExecutor } from '../src/tools/executor.js';
import { readFileTool } from '../src/tools/builtin/read_file.js';
import { PermissionSession } from '../src/permissions/session.js';

function createMockStream(events, finalContent) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) {
        yield e;
      }
    },
    finalMessage() {
      return Promise.resolve({ content: finalContent });
    },
  };
}

function createMockProvider() {
  let callCount = 0;
  return {
    stream(messages, tools, systemPrompt) {
      callCount++;
      if (callCount === 1) {
        return createMockStream([
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'read_file' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"/root/PROJECTS/atlas-agent/test/tmp/sample.txt"}' } },
          { type: 'content_block_stop', index: 0 },
        ], [{ type: 'tool_use', id: 't1', name: 'read_file', input: { path: '/root/PROJECTS/atlas-agent/test/tmp/sample.txt' } }]);
      }
      // Second call: text only, no tool use — loop should exit
      return createMockStream([
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Done.' } },
        { type: 'content_block_stop', index: 1 },
      ], [{ type: 'text', text: 'Done.' }]);
    },
  };
}

describe('agent loop', () => {
  it('executes tool use then exits on text-only response', async () => {
    const provider = createMockProvider();
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    const perms = new PermissionSession();
    const ctx = { workingDir: '/', abortSignal: new AbortController().signal, permissions: perms };
    const executor = new ToolExecutor(registry, ctx);

    // ensure sample exists
    const fs = await import('node:fs/promises');
    await fs.mkdir('/root/PROJECTS/atlas-agent/test/tmp', { recursive: true });
    await fs.writeFile('/root/PROJECTS/atlas-agent/test/tmp/sample.txt', 'hello\nworld', 'utf-8');

    const messages = [];
    const abortController = new AbortController();

    await runAgentLoop({ provider, messages, toolRegistry: registry, executor, abortSignal: abortController.signal });

    // Should have: assistant (tool_use), user (tool_result), assistant (text)
    expect(messages.length).toBe(3);
    expect(messages[0].role).toBe('assistant');
    expect(messages[1].role).toBe('user');
    expect(messages[2].role).toBe('assistant');
  });

  it('exits immediately when aborted', async () => {
    const provider = createMockProvider();
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    const perms = new PermissionSession();
    const abortController = new AbortController();
    abortController.abort();
    const ctx = { workingDir: '/', abortSignal: abortController.signal, permissions: perms };
    const executor = new ToolExecutor(registry, ctx);

    const messages = [];
    await runAgentLoop({ provider, messages, toolRegistry: registry, executor, abortSignal: abortController.signal });

    expect(messages.length).toBe(0);
  });
});
