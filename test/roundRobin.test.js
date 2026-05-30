import { describe, it, expect } from 'vitest';
import { makeRoundRobin, resolveModelPicker } from '../src/provider/roundRobin.js';

describe('makeRoundRobin', () => {
  it('cycles through models in order', () => {
    const pick = makeRoundRobin(['a', 'b', 'c']);
    expect(pick()).toBe('a');
    expect(pick()).toBe('b');
    expect(pick()).toBe('c');
    expect(pick()).toBe('a'); // wraps
    expect(pick()).toBe('b');
  });

  it('handles single-model pool', () => {
    const pick = makeRoundRobin(['only']);
    expect(pick()).toBe('only');
    expect(pick()).toBe('only');
  });

  it('throws on empty pool', () => {
    expect(() => makeRoundRobin([])).toThrow();
  });

  it('independent counters per picker', () => {
    const p1 = makeRoundRobin(['x', 'y']);
    const p2 = makeRoundRobin(['x', 'y']);
    expect(p1()).toBe('x');
    expect(p2()).toBe('x'); // p2 not affected by p1
    expect(p1()).toBe('y');
    expect(p2()).toBe('y');
  });
});

describe('resolveModelPicker', () => {
  it('single string always returns that string', () => {
    const pick = resolveModelPicker('gpt-5.5');
    expect(pick()).toBe('gpt-5.5');
    expect(pick()).toBe('gpt-5.5');
  });

  it('array round-robins', () => {
    const pick = resolveModelPicker(['gpt-5.5', 'claude-opus-4.7']);
    expect(pick()).toBe('gpt-5.5');
    expect(pick()).toBe('claude-opus-4.7');
    expect(pick()).toBe('gpt-5.5');
  });
});
