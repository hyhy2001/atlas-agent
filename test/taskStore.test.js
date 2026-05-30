import { describe, it, expect } from 'vitest';
import { TaskStore } from '../src/tasks/store.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

function makeTempStore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-tasks-'));
  const storePath = path.join(tmp, '.atlas', 'tasks.json');
  return { store: new TaskStore(storePath), storePath, tmp };
}

describe('TaskStore', () => {
  it('creates tasks with incrementing IDs', () => {
    const { store } = makeTempStore();
    const t1 = store.create({ subject: 'Task 1', description: 'Do thing 1' });
    const t2 = store.create({ subject: 'Task 2', description: 'Do thing 2' });
    expect(t1.id).toBe('1');
    expect(t2.id).toBe('2');
    expect(t1.status).toBe('pending');
  });

  it('gets task by id', () => {
    const { store } = makeTempStore();
    const t = store.create({ subject: 'Test', description: 'desc' });
    const got = store.get(t.id);
    expect(got).not.toBeNull();
    expect(got?.subject).toBe('Test');
  });

  it('returns null for missing id', () => {
    const { store } = makeTempStore();
    expect(store.get('999')).toBeNull();
  });

  it('lists only non-deleted tasks', () => {
    const { store } = makeTempStore();
    store.create({ subject: 'A', description: 'a' });
    const t2 = store.create({ subject: 'B', description: 'b' });
    store.delete(t2.id);
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0].subject).toBe('A');
  });

  it('updates status', () => {
    const { store } = makeTempStore();
    const t = store.create({ subject: 'X', description: 'x' });
    const updated = store.update(t.id, { status: 'in_progress' });
    expect(updated?.status).toBe('in_progress');
  });

  it('tracks blocks/blockedBy bidirectionally', () => {
    const { store } = makeTempStore();
    const t1 = store.create({ subject: 'A', description: 'a' });
    const t2 = store.create({ subject: 'B', description: 'b' });
    store.update(t1.id, { addBlocks: [t2.id] });
    expect(store.get(t1.id)?.blocks).toContain(t2.id);
    expect(store.get(t2.id)?.blockedBy).toContain(t1.id);
  });

  it('persists and reloads', async () => {
    const { store, storePath } = makeTempStore();
    store.create({ subject: 'Persist me', description: 'desc' });
    await store.save();
    const store2 = new TaskStore(storePath);
    await store2.load();
    const tasks = store2.list();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].subject).toBe('Persist me');
    expect(store2.get('1')).not.toBeNull();
  });

  it('delete marks as deleted', () => {
    const { store } = makeTempStore();
    const t = store.create({ subject: 'Del', description: 'd' });
    store.delete(t.id);
    expect(store.get(t.id)?.status).toBe('deleted');
    expect(store.list()).toHaveLength(0);
  });
});
