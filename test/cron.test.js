import { describe, it, expect } from 'vitest';
import { parseCron, matchesCron, nextFireTime } from '../src/cron/parser.js';
import { CronScheduler } from '../src/cron/scheduler.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

function makeStorePath() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-cron-'));
  return path.join(tmp, '.atlas', 'cron.json');
}

describe('parseCron', () => {
  it('parses "* * * * *" to full fields', () => {
    const f = parseCron('* * * * *');
    expect(f.minute).toHaveLength(60);
    expect(f.hour).toHaveLength(24);
    expect(f.dayOfMonth).toHaveLength(31);
    expect(f.month).toHaveLength(12);
    expect(f.dayOfWeek).toHaveLength(7);
    expect(f.minute[0]).toBe(0);
    expect(f.minute[59]).toBe(59);
  });

  it('parses step "*/15 * * * *"', () => {
    const f = parseCron('*/15 * * * *');
    expect(f.minute).toEqual([0, 15, 30, 45]);
  });

  it('parses "0 9 * * 1-5"', () => {
    const f = parseCron('0 9 * * 1-5');
    expect(f.minute).toEqual([0]);
    expect(f.hour).toEqual([9]);
    expect(f.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it('parses list and range "30 14 1,15 * *"', () => {
    const f = parseCron('30 14 1,15 * *');
    expect(f.minute).toEqual([30]);
    expect(f.hour).toEqual([14]);
    expect(f.dayOfMonth).toEqual([1, 15]);
  });

  it('parses range with step "0-30/10 * * * *"', () => {
    const f = parseCron('0-30/10 * * * *');
    expect(f.minute).toEqual([0, 10, 20, 30]);
  });

  it('throws on 4 fields', () => {
    expect(() => parseCron('* * * *')).toThrow('Cron expression must have 5 fields');
  });

  it('throws on out-of-range minute "60 * * * *"', () => {
    expect(() => parseCron('60 * * * *')).toThrow();
  });

  it('throws on out-of-range dayOfWeek "* * * * 7"', () => {
    expect(() => parseCron('* * * * 7')).toThrow();
  });
});

describe('matchesCron', () => {
  it('matches "*/15 * * * *" at minute 30 but not 31', () => {
    const f = parseCron('*/15 * * * *');
    const at30 = new Date(2026, 4, 30, 10, 30, 0);
    const at31 = new Date(2026, 4, 30, 10, 31, 0);
    expect(matchesCron(f, at30)).toBe(true);
    expect(matchesCron(f, at31)).toBe(false);
  });

  it('matches "0 9 * * 1" on Monday 9am but not Tuesday', () => {
    const f = parseCron('0 9 * * 1');
    // 2026-06-01 is a Monday
    const monday = new Date(2026, 5, 1, 9, 0, 0);
    const tuesday = new Date(2026, 5, 2, 9, 0, 0);
    expect(monday.getDay()).toBe(1);
    expect(matchesCron(f, monday)).toBe(true);
    expect(matchesCron(f, tuesday)).toBe(false);
  });

  it('uses OR semantics when both dom and dow restricted', () => {
    const f = parseCron('0 0 13 * 5');
    // 2026-02-13 is a Friday (dow=5), matches via either
    const friday13 = new Date(2026, 1, 13, 0, 0, 0);
    expect(matchesCron(f, friday13)).toBe(true);
    // a non-13th Friday still matches via dow
    const friday6 = new Date(2026, 1, 6, 0, 0, 0);
    expect(friday6.getDay()).toBe(5);
    expect(matchesCron(f, friday6)).toBe(true);
  });
});

describe('nextFireTime', () => {
  it('returns next quarter-hour for "*/15 * * * *"', () => {
    const f = parseCron('*/15 * * * *');
    const from = new Date(2026, 4, 30, 10, 7, 30);
    const next = nextFireTime(f, from);
    expect(next.getMinutes()).toBe(15);
    expect(next.getHours()).toBe(10);
    expect(next.getSeconds()).toBe(0);
  });

  it('advances at least one minute', () => {
    const f = parseCron('* * * * *');
    const from = new Date(2026, 4, 30, 10, 7, 0);
    const next = nextFireTime(f, from);
    expect(next.getMinutes()).toBe(8);
  });
});

describe('CronScheduler', () => {
  it('add validates and computes nextFireAt', () => {
    const s = new CronScheduler(makeStorePath());
    const job = s.add({ cron: '*/15 * * * *', prompt: 'hello', durable: false });
    expect(job.id).toBe('1');
    expect(new Date(job.nextFireAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('add throws on bad cron', () => {
    const s = new CronScheduler(makeStorePath());
    expect(() => s.add({ cron: 'nonsense', prompt: 'x', durable: false })).toThrow();
  });

  it('list sorted by nextFireAt', () => {
    const s = new CronScheduler(makeStorePath());
    s.add({ cron: '0 12 * * *', prompt: 'noon', durable: false });
    s.add({ cron: '* * * * *', prompt: 'soon', durable: false });
    const list = s.list();
    expect(list[0].prompt).toBe('soon');
    expect(new Date(list[0].nextFireAt).getTime()).toBeLessThanOrEqual(new Date(list[1].nextFireAt).getTime());
  });

  it('remove returns true then false', () => {
    const s = new CronScheduler(makeStorePath());
    const job = s.add({ cron: '* * * * *', prompt: 'x', durable: false });
    expect(s.remove(job.id)).toBe(true);
    expect(s.remove(job.id)).toBe(false);
  });

  it('tick fires due recurring job and advances nextFireAt', async () => {
    const s = new CronScheduler(makeStorePath());
    const fired = [];
    s.onFire((job) => { fired.push(job.id); });
    const job = s.add({ cron: '* * * * *', prompt: 'tick me', recurring: true, durable: false });
    const now = new Date(new Date(job.nextFireAt).getTime() + 2 * 60_000);
    await s.tick(now);
    expect(fired).toContain(job.id);
    const after = s.list().find((j) => j.id === job.id);
    expect(after).toBeDefined();
    expect(new Date(after.nextFireAt).getTime()).toBeGreaterThan(now.getTime());
    expect(after.lastFiredAt).toBeDefined();
  });

  it('tick removes non-recurring job after fire', async () => {
    const s = new CronScheduler(makeStorePath());
    const fired = [];
    s.onFire((job) => { fired.push(job.id); });
    const job = s.add({ cron: '* * * * *', prompt: 'once', recurring: false, durable: false });
    const now = new Date(new Date(job.nextFireAt).getTime() + 2 * 60_000);
    await s.tick(now);
    expect(fired).toContain(job.id);
    expect(s.list().find((j) => j.id === job.id)).toBeUndefined();
  });

  it('tick does not fire jobs not yet due', async () => {
    const s = new CronScheduler(makeStorePath());
    const fired = [];
    s.onFire((job) => { fired.push(job.id); });
    const job = s.add({ cron: '* * * * *', prompt: 'later', recurring: true, durable: false });
    const now = new Date(new Date(job.nextFireAt).getTime() - 60_000);
    await s.tick(now);
    expect(fired).toHaveLength(0);
  });

  it('persists durable jobs and reloads', async () => {
    const storePath = makeStorePath();
    const s = new CronScheduler(storePath);
    s.add({ cron: '0 9 * * *', prompt: 'durable one', durable: true });
    s.add({ cron: '0 10 * * *', prompt: 'ephemeral', durable: false });
    await s.saveDurable();
    const s2 = new CronScheduler(storePath);
    await s2.load();
    const list = s2.list();
    expect(list).toHaveLength(1);
    expect(list[0].prompt).toBe('durable one');
  });

  it('handler errors do not break the tick loop', async () => {
    const s = new CronScheduler(makeStorePath());
    s.onFire(() => { throw new Error('boom'); });
    const job = s.add({ cron: '* * * * *', prompt: 'x', recurring: false, durable: false });
    const now = new Date(new Date(job.nextFireAt).getTime() + 2 * 60_000);
    await expect(s.tick(now)).resolves.toBeUndefined();
    expect(s.list().find((j) => j.id === job.id)).toBeUndefined();
  });
});
