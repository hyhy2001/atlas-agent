import { describe, it, expect } from 'vitest';
import { matchHooks, buildHookEnv } from '../src/hooks.js';

describe('matchHooks', () => {
  const hooks = [
    { matcher: 'edit_file', command: 'echo edit' },
    { matcher: 'bash', command: 'echo bash' },
    { matcher: '*', command: 'echo all' },
  ];

  it('matches exact tool name', () => {
    const result = matchHooks(hooks, 'edit_file');
    expect(result).toHaveLength(2);
    expect(result[0].matcher).toBe('edit_file');
    expect(result[1].matcher).toBe('*');
  });

  it('matches wildcard "*"', () => {
    const result = matchHooks(hooks, 'some_random_tool');
    expect(result).toHaveLength(1);
    expect(result[0].matcher).toBe('*');
  });

  it('returns empty for non-matching tool when no wildcard', () => {
    const noWildcard = [
      { matcher: 'edit_file', command: 'echo edit' },
      { matcher: 'bash', command: 'echo bash' },
    ];
    const result = matchHooks(noWildcard, 'read_file');
    expect(result).toHaveLength(0);
  });
});

describe('buildHookEnv', () => {
  it('extracts TOOL_PATH for edit_file', () => {
    const env = buildHookEnv('edit_file', { path: '/tmp/foo.ts', old_string: 'a', new_string: 'b' });
    expect(env.TOOL_NAME).toBe('edit_file');
    expect(env.TOOL_PATH).toBe('/tmp/foo.ts');
    expect(env.TOOL_INPUT).toBe(JSON.stringify({ path: '/tmp/foo.ts', old_string: 'a', new_string: 'b' }));
  });

  it('extracts TOOL_PATH for write_file', () => {
    const env = buildHookEnv('write_file', { path: '/tmp/bar.ts', content: 'hello' });
    expect(env.TOOL_PATH).toBe('/tmp/bar.ts');
  });

  it('extracts TOOL_PATH for read_file', () => {
    const env = buildHookEnv('read_file', { path: '/tmp/baz.ts' });
    expect(env.TOOL_PATH).toBe('/tmp/baz.ts');
  });

  it('extracts TOOL_COMMAND for bash', () => {
    const env = buildHookEnv('bash', { command: 'ls -la' });
    expect(env.TOOL_NAME).toBe('bash');
    expect(env.TOOL_COMMAND).toBe('ls -la');
  });

  it('extracts TOOL_PATTERN for grep', () => {
    const env = buildHookEnv('grep', { pattern: 'TODO', path: '/src' });
    expect(env.TOOL_NAME).toBe('grep');
    expect(env.TOOL_PATTERN).toBe('TODO');
  });

  it('always includes TOOL_NAME and TOOL_INPUT', () => {
    const env = buildHookEnv('unknown_tool', { foo: 'bar' });
    expect(env.TOOL_NAME).toBe('unknown_tool');
    expect(env.TOOL_INPUT).toBe(JSON.stringify({ foo: 'bar' }));
    expect(env.TOOL_PATH).toBeUndefined();
    expect(env.TOOL_COMMAND).toBeUndefined();
    expect(env.TOOL_PATTERN).toBeUndefined();
  });
});
