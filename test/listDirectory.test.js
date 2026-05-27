import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { listDirectoryTool } from '../src/tools/builtin/list_directory.js';

const TEST_DIR = '/root/PROJECTS/atlas-agent/test/tmp_listdir';

function makeCtx() {
  return { workingDir: '/', abortSignal: new AbortController().signal, permissions: { check: () => true, grant: () => {} } };
}

beforeAll(async () => {
  await mkdir(`${TEST_DIR}/subdir/nested`, { recursive: true });
  await mkdir(`${TEST_DIR}/.hidden_dir`, { recursive: true });
  await mkdir(`${TEST_DIR}/node_modules`, { recursive: true });
  await writeFile(`${TEST_DIR}/file_a.txt`, 'a', 'utf-8');
  await writeFile(`${TEST_DIR}/file_b.ts`, 'b', 'utf-8');
  await writeFile(`${TEST_DIR}/.dotfile`, 'hidden', 'utf-8');
  await writeFile(`${TEST_DIR}/subdir/child.txt`, 'c', 'utf-8');
  await writeFile(`${TEST_DIR}/subdir/nested/deep.txt`, 'd', 'utf-8');
  await writeFile(`${TEST_DIR}/node_modules/pkg.js`, 'x', 'utf-8');
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('list_directory tool', () => {
  it('lists files and directories sorted (dirs first)', async () => {
    const res = await listDirectoryTool.execute({ path: TEST_DIR }, makeCtx());
    expect(res.isError).toBe(false);
    const lines = res.content.split('\n');
    const dirLines = lines.filter(l => l.endsWith('/'));
    const fileLines = lines.filter(l => !l.endsWith('/'));
    expect(dirLines.length).toBeGreaterThan(0);
    expect(lines.indexOf(dirLines[dirLines.length - 1])).toBeLessThan(lines.indexOf(fileLines[0]));
  });

  it('skips node_modules automatically', async () => {
    const res = await listDirectoryTool.execute({ path: TEST_DIR }, makeCtx());
    expect(res.content).not.toContain('node_modules');
  });

  it('excludes hidden files by default', async () => {
    const res = await listDirectoryTool.execute({ path: TEST_DIR }, makeCtx());
    expect(res.content).not.toContain('.dotfile');
    expect(res.content).not.toContain('.hidden_dir');
  });

  it('includes hidden files when include_hidden=true', async () => {
    const res = await listDirectoryTool.execute({ path: TEST_DIR, include_hidden: true }, makeCtx());
    expect(res.content).toContain('.dotfile');
    expect(res.content).toContain('.hidden_dir/');
  });

  it('recurses into subdirectories', async () => {
    const res = await listDirectoryTool.execute({ path: TEST_DIR, recursive: true }, makeCtx());
    expect(res.content).toContain('subdir/');
    expect(res.content).toContain('  nested/');
    expect(res.content).toContain('  child.txt');
    expect(res.content).toContain('    deep.txt');
  });

  it('respects max_depth', async () => {
    const res = await listDirectoryTool.execute({ path: TEST_DIR, recursive: true, max_depth: 1 }, makeCtx());
    expect(res.content).toContain('subdir/');
    expect(res.content).toContain('  child.txt');
    expect(res.content).not.toContain('deep.txt');
  });

  it('returns error for non-existent path', async () => {
    const res = await listDirectoryTool.execute({ path: '/nonexistent_xyz_path' }, makeCtx());
    expect(res.isError).toBe(true);
    expect(res.content).toContain('Error listing directory');
  });

  it('marks directories with trailing slash', async () => {
    const res = await listDirectoryTool.execute({ path: TEST_DIR }, makeCtx());
    expect(res.content).toContain('subdir/');
  });
});
