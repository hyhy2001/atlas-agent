import { describe, it, expect } from 'vitest';
import { PlanMode } from '../src/agent/plan_mode.js';
import { ToolRegistry } from '../src/tools/registry.js';

function makeTool(name, isDestructive) {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { properties: {} },
    isDestructive,
    execute: async () => ({ toolUseId: '1', content: 'ok', isError: false }),
  };
}

describe('PlanMode', () => {
  it('starts inactive', () => {
    const pm = new PlanMode();
    expect(pm.isActive()).toBe(false);
  });

  it('enter() makes isActive() true', () => {
    const pm = new PlanMode();
    pm.enter();
    expect(pm.isActive()).toBe(true);
  });

  it('exit() makes isActive() false', () => {
    const pm = new PlanMode();
    pm.enter();
    pm.exit();
    expect(pm.isActive()).toBe(false);
  });

  it('filterRegistry removes destructive tools, keeps non-destructive ones', () => {
    const pm = new PlanMode();
    const registry = new ToolRegistry();
    registry.register(makeTool('read_file', false));
    registry.register(makeTool('grep', false));
    registry.register(makeTool('edit_file', true));
    registry.register(makeTool('bash', true));

    const filtered = pm.filterRegistry(registry);
    const names = filtered.getAll().map((t) => t.name);

    expect(names).toContain('read_file');
    expect(names).toContain('grep');
    expect(names).not.toContain('edit_file');
    expect(names).not.toContain('bash');
    expect(filtered.getAll()).toHaveLength(2);
  });
});
