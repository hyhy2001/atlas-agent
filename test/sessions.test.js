import { describe, it, expect } from 'vitest';
import { generateSessionId, saveSession, loadSession, listSessions } from '../src/sessions.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

function makeSession(overrides = {}) {
  const id = generateSessionId();
  const now = new Date().toISOString();
  return Object.assign({
    id,
    createdAt: now,
    updatedAt: now,
    model: 'test-model',
    messageCount: 1,
    messages: [{ role: 'user', content: 'hello' }],
  }, overrides);
}

describe('sessions', () => {
  it('generateSessionId produces expected format', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^\d{8}-\d{6}-[0-9a-f]{8}$/);
  });

  it('save + load roundtrip', async () => {
    const s = makeSession();
    await saveSession(s);
    const loaded = await loadSession(s.id);
    expect(loaded).not.toBeNull();
    expect(loaded.id).toBe(s.id);
    expect(loaded.messages.length).toBe(1);
  });

  it('listSessions returns sorted results', async () => {
    const s1 = makeSession();
    const s2 = makeSession();
    s2.updatedAt = new Date(Date.now() + 1000).toISOString();
    await saveSession(s1);
    await saveSession(s2);
    const listed = await listSessions();
    expect(listed.length).toBeGreaterThanOrEqual(2);
    expect(listed[0].id).toBe(s2.id);
  });
});
