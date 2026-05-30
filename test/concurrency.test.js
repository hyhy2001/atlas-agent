import { describe, it, expect } from 'vitest';
import { sequential } from '../src/utils/sequential.js';
import { partitionTasksByFiles } from '../src/tools/builtin/delegate.js';

describe('sequential', () => {
  it('runs concurrent calls one at a time in order', async () => {
    const order = [];
    const fn = sequential(async (n) => {
      order.push(`start-${n}`);
      await new Promise(r => setTimeout(r, 20 - n * 5));
      order.push(`end-${n}`);
      return n;
    });

    const results = await Promise.all([fn(1), fn(2), fn(3)]);
    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
  });

  it('continues queue after a rejection', async () => {
    const fn = sequential(async (n) => {
      if (n === 1) throw new Error('boom');
      return n * 2;
    });

    const r1 = fn(1).catch(e => e.message);
    const r2 = fn(2);
    const r3 = fn(3);
    expect(await r1).toBe('boom');
    expect(await r2).toBe(4);
    expect(await r3).toBe(6);
  });

  it('preserves arguments and return type', async () => {
    const fn = sequential(async (a, b) => `${a}:${b}`);
    expect(await fn('x', 7)).toBe('x:7');
  });
});

describe('partitionTasksByFiles', () => {
  it('places tasks with disjoint files in separate parallel groups', () => {
    const tasks = [
      { agent: 'atlas-forge', task: 'A', files: ['a.ts'] },
      { agent: 'atlas-forge', task: 'B', files: ['b.ts'] },
      { agent: 'atlas-forge', task: 'C', files: ['c.ts'] },
    ];
    const groups = partitionTasksByFiles(tasks);
    expect(groups).toHaveLength(3);
    expect(groups.every(g => g.length === 1)).toBe(true);
  });

  it('groups tasks that share files into one serial group', () => {
    const tasks = [
      { agent: 'atlas-forge', task: 'A', files: ['shared.ts'] },
      { agent: 'atlas-forge', task: 'B', files: ['shared.ts', 'b.ts'] },
      { agent: 'atlas-forge', task: 'C', files: ['c.ts'] },
    ];
    const groups = partitionTasksByFiles(tasks);
    expect(groups).toHaveLength(2);
    const sharedGroup = groups.find(g => g.length === 2);
    expect(sharedGroup).toBeDefined();
    expect(sharedGroup.map(x => x.task.task)).toEqual(['A', 'B']);
  });

  it('places tasks with no files in their own serial groups', () => {
    const tasks = [
      { agent: 'atlas-forge', task: 'A', files: [] },
      { agent: 'atlas-forge', task: 'B' },
      { agent: 'atlas-forge', task: 'C', files: ['c.ts'] },
    ];
    const groups = partitionTasksByFiles(tasks);
    expect(groups).toHaveLength(3);
  });

  it('preserves original index for stable output order', () => {
    const tasks = [
      { agent: 'atlas-forge', task: 'A', files: ['x.ts'] },
      { agent: 'atlas-forge', task: 'B', files: ['x.ts'] },
      { agent: 'atlas-forge', task: 'C', files: ['y.ts'] },
    ];
    const groups = partitionTasksByFiles(tasks);
    const allItems = groups.flat();
    expect(allItems.map(i => i.index).sort()).toEqual([0, 1, 2]);
  });
});
