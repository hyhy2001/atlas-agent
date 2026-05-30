import { describe, it, expect, afterEach } from 'vitest';
import { bytesPerTokenForFile, estimateTokens } from '../src/utils/tokenEstimation.js';
import { getCachedTools, clearToolSchemaCache } from '../src/utils/toolSchemaCache.js';
import { offloadIfLarge } from '../src/utils/toolResultStorage.js';

describe('bytesPerTokenForFile', () => {
  it('uses ratio 2 for JSON-family files', () => {
    expect(bytesPerTokenForFile('data.json')).toBe(2);
    expect(bytesPerTokenForFile('logs.jsonl')).toBe(2);
    expect(bytesPerTokenForFile('config.jsonc')).toBe(2);
  });
  it('uses ratio 4 for other files', () => {
    expect(bytesPerTokenForFile('main.ts')).toBe(4);
    expect(bytesPerTokenForFile('readme.md')).toBe(4);
    expect(bytesPerTokenForFile(undefined)).toBe(4);
  });
});

describe('estimateTokens', () => {
  it('estimates fewer tokens-per-byte for JSON', () => {
    const text = '{"key":"value","arr":[1,2,3]}';
    const jsonEst = estimateTokens(text, 'x.json');
    const txtEst = estimateTokens(text, 'x.txt');
    // JSON ratio is smaller (2), so it yields MORE tokens for same bytes
    expect(jsonEst).toBeGreaterThan(txtEst);
  });
  it('counts bytes not chars for multibyte', () => {
    const est = estimateTokens('日本語', 'x.txt');
    expect(est).toBe(Math.ceil(9 / 4)); // 3 chars × 3 bytes = 9 bytes
  });
});

describe('toolSchemaCache', () => {
  afterEach(() => clearToolSchemaCache());

  it('returns same reference across calls with same tool count', () => {
    const tools1 = [{ type: 'function', function: { name: 'a', description: '', parameters: {} } }];
    const first = getCachedTools(tools1);
    const tools2 = [{ type: 'function', function: { name: 'a', description: 'changed', parameters: {} } }];
    const second = getCachedTools(tools2);
    expect(second).toBe(first); // cached — ignores the changed schema
  });

  it('refreshes cache when tool count changes', () => {
    const one = getCachedTools([{ type: 'function', function: { name: 'a', description: '', parameters: {} } }]);
    const two = getCachedTools([
      { type: 'function', function: { name: 'a', description: '', parameters: {} } },
      { type: 'function', function: { name: 'b', description: '', parameters: {} } },
    ]);
    expect(two).not.toBe(one);
    expect(two).toHaveLength(2);
  });
});

describe('offloadIfLarge', () => {
  it('returns content unchanged when small', async () => {
    const small = 'short output';
    expect(await offloadIfLarge('t1', small)).toBe(small);
  });

  it('offloads large content to disk with preview + path', async () => {
    const large = 'x'.repeat(25_000);
    const result = await offloadIfLarge('t-large-' + Date.now(), large);
    expect(result.length).toBeLessThan(large.length);
    expect(result).toContain('Output truncated');
    expect(result).toContain('Full output saved to');
    expect(result).toContain('.txt');
  });
});
