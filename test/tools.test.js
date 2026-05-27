import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileTool } from '../src/tools/builtin/read_file.js';
import { editFileTool } from '../src/tools/builtin/edit_file.js';
import { grepTool } from '../src/tools/builtin/grep.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolExecutor } from '../src/tools/executor.js';
import { PermissionSession } from '../src/permissions/session.js';

vi.mock('../src/permissions/prompt.js', () => ({
  askPermission: vi.fn(async () => 'always'),
}));

const TEST_DIR = '/root/PROJECTS/atlas-agent/test/tmp';

function makeCtx() {
  return { workingDir: '/', abortSignal: new AbortController().signal, permissions: new PermissionSession() };
}

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

beforeEach(async () => {
  await writeFile(`${TEST_DIR}/sample.txt`, 'line1\nline2\nneedle\nline4', 'utf-8');
});

describe('read_file tool', () => {
  it('returns numbered lines with offset and limit', async () => {
    const res = await readFileTool.execute({ path: `${TEST_DIR}/sample.txt`, offset: 1, limit: 2 }, makeCtx());
    expect(res.isError).toBe(false);
    expect(res.content).toContain('line2');
    expect(res.content).toContain('needle');
    expect(res.content).not.toContain('line1');
  });
});

describe('edit_file tool', () => {
  it('replaces a unique string', async () => {
    const ctx = makeCtx();
    const r1 = await editFileTool.execute({ path: `${TEST_DIR}/sample.txt`, old_string: 'needle', new_string: 'replaced' }, ctx);
    expect(r1.isError).toBe(false);
    const r2 = await readFileTool.execute({ path: `${TEST_DIR}/sample.txt` }, ctx);
    expect(r2.content).toContain('replaced');
    expect(r2.content).not.toContain('needle');
  });

  it('errors when old_string not found', async () => {
    const res = await editFileTool.execute({ path: `${TEST_DIR}/sample.txt`, old_string: 'nonexistent', new_string: 'x' }, makeCtx());
    expect(res.isError).toBe(true);
    expect(res.content).toContain('not found');
  });

  it('errors when old_string is not unique', async () => {
    await writeFile(`${TEST_DIR}/sample.txt`, 'aaa\naaa\nbbb', 'utf-8');
    const res = await editFileTool.execute({ path: `${TEST_DIR}/sample.txt`, old_string: 'aaa', new_string: 'x' }, makeCtx());
    expect(res.isError).toBe(true);
    expect(res.content).toContain('2 times');
  });
});

describe('grep tool', () => {
  it('finds matching lines', async () => {
    const res = await grepTool.execute({ pattern: 'needle', path: TEST_DIR }, makeCtx());
    expect(res.isError).toBe(false);
    expect(res.content).toContain('needle');
  });

  it('reports no matches', async () => {
    const res = await grepTool.execute({ pattern: 'zzzznothere', path: TEST_DIR }, makeCtx());
    expect(res.isError).toBe(false);
    expect(res.content).toContain('No matches found');
  });
});

describe('ToolExecutor integration', () => {
  it('executes read-only tools without permission', async () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    const ctx = makeCtx();
    const executor = new ToolExecutor(registry, ctx);

    const results = await executor.execute([
      { id: '1', name: 'read_file', input: { path: `${TEST_DIR}/sample.txt` } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].isError).toBe(false);
    expect(results[0].toolUseId).toBe('1');
  });

  it('executes destructive tools with mocked permission', async () => {
    const registry = new ToolRegistry();
    registry.register(editFileTool);
    const ctx = makeCtx();
    const executor = new ToolExecutor(registry, ctx);

    const results = await executor.execute([
      { id: '2', name: 'edit_file', input: { path: `${TEST_DIR}/sample.txt`, old_string: 'needle', new_string: 'x' } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].isError).toBe(false);
  });

  it('returns error for unknown tool', async () => {
    const registry = new ToolRegistry();
    const ctx = makeCtx();
    const executor = new ToolExecutor(registry, ctx);

    const results = await executor.execute([{ id: '3', name: 'nope', input: {} }]);
    expect(results[0].isError).toBe(true);
    expect(results[0].content).toContain('Unknown tool');
  });
});
