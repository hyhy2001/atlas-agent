import { describe, it, expect } from 'vitest';
import { formatApiError } from '../src/tui/App.js';

describe('formatApiError', () => {
  it('formats rate limit 429', () => {
    const r = formatApiError(new Error('HTTP 429 rate limit exceeded'));
    expect(r).toContain('Rate limit hit');
    expect(r).toContain('429');
  });

  it('formats 529 overloaded', () => {
    const r = formatApiError(new Error('529 overloaded'));
    expect(r).toContain('overloaded');
  });

  it('formats ECONNRESET', () => {
    const r = formatApiError(new Error('ECONNRESET'));
    expect(r).toContain('Connection dropped');
  });

  it('formats 401 auth error', () => {
    const r = formatApiError(new Error('401 unauthorized'));
    expect(r).toContain('Authentication failed');
  });

  it('formats context length error', () => {
    const r = formatApiError(new Error('prompt is too long: 200000 tokens'));
    expect(r).toContain('Context too long');
  });

  it('falls back to generic Error: prefix', () => {
    const r = formatApiError(new Error('something unexpected'));
    expect(r).toContain('Error: something unexpected');
  });

  it('handles non-Error objects', () => {
    const r = formatApiError('plain string error');
    expect(r).toContain('plain string error');
  });
});
