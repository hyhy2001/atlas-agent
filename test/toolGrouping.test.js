import { describe, it, expect } from 'vitest';
import { groupConsecutiveToolCalls } from '../src/tui/components/MessageList.js';

const call = (toolName, text = '') => ({ type: 'tool_call', toolName, text });
const result = (text = 'ok') => ({ type: 'tool_result', text });

describe('groupConsecutiveToolCalls', () => {
  it('groups 3+ consecutive read_file calls', () => {
    const history = [
      call('read_file', 'a.ts'),
      call('read_file', 'b.ts'),
      call('read_file', 'c.ts'),
    ];
    const out = groupConsecutiveToolCalls(history);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('3 calls');
    expect(out[0].toolName).toBe('read_file');
  });

  it('does NOT group fewer than 3 calls', () => {
    const history = [call('read_file', 'a.ts'), call('read_file', 'b.ts')];
    const out = groupConsecutiveToolCalls(history);
    expect(out).toHaveLength(2);
  });

  it('does NOT group edit_file or bash (non-noisy tools)', () => {
    const history = [
      call('edit_file', 'a.ts'),
      call('edit_file', 'b.ts'),
      call('edit_file', 'c.ts'),
    ];
    const out = groupConsecutiveToolCalls(history);
    expect(out).toHaveLength(3);
  });

  it('groups across interleaved tool_result entries', () => {
    const history = [
      call('grep', 'foo'),
      result(),
      call('grep', 'bar'),
      result(),
      call('grep', 'baz'),
      result(),
    ];
    const out = groupConsecutiveToolCalls(history);
    const grouped = out.find(e => e.type === 'tool_call' && e.text === '3 calls');
    expect(grouped).toBeDefined();
  });

  it('preserves non-tool entries', () => {
    const history = [
      { type: 'user', text: 'hi' },
      call('read_file', 'a.ts'),
      { type: 'assistant', text: 'done' },
    ];
    const out = groupConsecutiveToolCalls(history);
    expect(out[0].type).toBe('user');
    expect(out[out.length - 1].type).toBe('assistant');
  });

  it('does not group different tool names together', () => {
    const history = [
      call('read_file', 'a.ts'),
      call('grep', 'x'),
      call('glob', '*.ts'),
    ];
    const out = groupConsecutiveToolCalls(history);
    expect(out).toHaveLength(3);
  });
});
