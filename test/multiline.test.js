import { describe, it, expect } from 'vitest';
import { isMultilineStart, isMultilineEnd, shouldContinue, stripContinuation } from '../src/multiline.js';

describe('multiline helpers', () => {
  it('detects triple backtick start', () => {
    expect(isMultilineStart('```')).toBe(true);
    expect(isMultilineStart('  ```  ')).toBe(true);
    expect(isMultilineStart('`')).toBe(false);
    expect(isMultilineStart('``` code')).toBe(false);
  });

  it('detects triple backtick end', () => {
    expect(isMultilineEnd('```')).toBe(true);
    expect(isMultilineEnd('  ```')).toBe(true);
    expect(isMultilineEnd('``` ')).toBe(true);
    expect(isMultilineEnd('```end')).toBe(false);
  });

  it('detects trailing backslash continuation', () => {
    expect(shouldContinue('hello \\')).toBe(true);
    expect(shouldContinue('no slash')).toBe(false);
    expect(shouldContinue('endswith\\')).toBe(true);
  });

  it('strips continuation', () => {
    expect(stripContinuation('hello \\')).toBe('hello ');
    expect(stripContinuation('no slash')).toBe('no slash');
    expect(stripContinuation('endswith\\')).toBe('endswith');
  });
});
