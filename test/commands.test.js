import { describe, it, expect } from 'vitest';
import { parseCommandFile, loadCommands } from '../src/commands.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('parseCommandFile', () => {
  it('parses frontmatter', () => {
    const content = `---\nname: scan-rtl\ndescription: Scan RTL files\n---\n\nScan files`;
    const cmd = parseCommandFile(content, '/tmp/scan-rtl.md');
    expect(cmd.name).toBe('scan-rtl');
    expect(cmd.description).toBe('Scan RTL files');
    expect(cmd.promptBody.trim()).toBe('Scan files');
  });

  it('parses file without frontmatter', () => {
    const content = 'Do something\nwith files';
    const cmd = parseCommandFile(content, '/tmp/run.md');
    expect(cmd.name).toBe('run');
    expect(cmd.description).toBe('');
    expect(cmd.promptBody).toContain('Do something');
  });
});

describe('loadCommands', () => {
  it('loads commands from dirs and respects overrides', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-cmds-'));
    const cwd = path.join(tmp, 'project');

    // Create project-local commands
    await fs.mkdir(path.join(cwd, '.atlas', 'commands'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.atlas', 'commands', 'a.md'), '---\nname: a\ndescription: project a\n---\nProject A');
    await fs.writeFile(path.join(cwd, '.atlas', 'commands', 'b.md'), '---\nname: b\ndescription: project b\n---\nProject B');

    const cmds = await loadCommands(cwd);

    const names = cmds.map((c) => c.name).sort();
    expect(names).toContain('a');
    expect(names).toContain('b');

    const b = cmds.find((c) => c.name === 'b');
    expect(b.description).toBe('project b');
  });
});
