import { describe, it, expect } from 'vitest';
import { nonEmptyContent } from '../src/tools/executor.js';
import { isStaleConnectionError, parseContextOverflow } from '../src/provider/openai.js';

describe('nonEmptyContent', () => {
  it('replaces empty string with marker', () => {
    expect(nonEmptyContent('bash', '')).toBe('(bash completed with no output)');
  });
  it('replaces whitespace-only with marker', () => {
    expect(nonEmptyContent('grep', '   \n  ')).toBe('(grep completed with no output)');
  });
  it('replaces empty array/object literals', () => {
    expect(nonEmptyContent('glob', '[]')).toBe('(glob completed with no output)');
    expect(nonEmptyContent('x', '{}')).toBe('(x completed with no output)');
  });
  it('preserves non-empty content', () => {
    expect(nonEmptyContent('bash', 'hello')).toBe('hello');
    expect(nonEmptyContent('read', '0')).toBe('0');
  });
});

describe('isStaleConnectionError', () => {
  it('detects ECONNRESET by code', () => {
    expect(isStaleConnectionError({ code: 'ECONNRESET' })).toBe(true);
  });
  it('detects EPIPE in cause chain', () => {
    expect(isStaleConnectionError({ cause: { code: 'EPIPE' } })).toBe(true);
  });
  it('detects socket hang up by message', () => {
    expect(isStaleConnectionError({ message: 'socket hang up' })).toBe(true);
  });
  it('returns false for unrelated errors', () => {
    expect(isStaleConnectionError({ code: 'ETIMEDOUT' })).toBe(false);
    expect(isStaleConnectionError({ message: 'bad request' })).toBe(false);
    expect(isStaleConnectionError(null)).toBe(false);
  });
});

describe('parseContextOverflow', () => {
  it('parses input and context limit from 400 error', () => {
    const err = { status: 400, message: 'prompt is too long: 205000 tokens > 200000 maximum' };
    const r = parseContextOverflow(err);
    expect(r).toEqual({ inputTokens: 205000, contextLimit: 200000 });
  });
  it('returns null for non-400 errors', () => {
    expect(parseContextOverflow({ status: 429, message: 'rate limit 100000 of 200000' })).toBeNull();
  });
  it('returns null when message lacks context keywords', () => {
    expect(parseContextOverflow({ status: 400, message: 'invalid 12345 field 67890' })).toBeNull();
  });
  it('returns null when fewer than 2 numbers', () => {
    expect(parseContextOverflow({ status: 400, message: 'context exceeded at 200000' })).toBeNull();
  });
});
