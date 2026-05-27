import { describe, it, expect } from 'vitest';
import { getSubagent, listSubagents, filterRegistryForSubagent } from '../src/agent/subagents.js';
import { ToolRegistry } from '../src/tools/registry.js';

describe('subagents', () => {
  it('getSubagent returns profile', () => {
    const s = getSubagent('code-reviewer');
    expect(s).toBeDefined();
    expect(s.name).toBe('code-reviewer');
  });

  it('getSubagent returns undefined for nonexistent', () => {
    const s = getSubagent('no-such-agent');
    expect(s).toBeUndefined();
  });

  it('listSubagents includes builtins', () => {
    const arr = listSubagents();
    const names = arr.map((a) => a.name).sort();
    expect(names).toEqual(['code-reviewer', 'explainer', 'refactorer', 'test-writer'].sort());
  });

  it('filterRegistryForSubagent respects restrictedTools', () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'read_file', description: 'r', inputSchema: {}, isDestructive: false, execute: async () => ({ toolUseId: '1', content: 'x', isError: false }) });
    reg.register({ name: 'write_file', description: 'w', inputSchema: {}, isDestructive: true, execute: async () => ({ toolUseId: '2', content: 'x', isError: false }) });

    const profile = getSubagent('code-reviewer');
    if (!profile) throw new Error('Expected code-reviewer profile');
    const filtered = filterRegistryForSubagent(reg, profile);
    expect(filtered.get('read_file')).toBeDefined();
    expect(filtered.get('write_file')).toBeUndefined();
  });

  it('filterRegistryForSubagent with allowedTools only keeps those tools', () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'read_file', description: 'r', inputSchema: {}, isDestructive: false, execute: async () => ({ toolUseId: '1', content: 'x', isError: false }) });
    reg.register({ name: 'grep', description: 'g', inputSchema: {}, isDestructive: false, execute: async () => ({ toolUseId: '2', content: 'x', isError: false }) });

    const profile = { name: 't', description: '', systemPrompt: '', allowedTools: ['grep'], restrictedTools: [] };
    const filtered = filterRegistryForSubagent(reg, profile);
    expect(filtered.get('read_file')).toBeUndefined();
    expect(filtered.get('grep')).toBeDefined();
  });
});
