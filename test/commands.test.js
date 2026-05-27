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
    const globalDir = path.join(tmp, 'global');
    const localDir = path.join(tmp, 'local');
    await fs.mkdir(globalDir, { recursive: true });
    await fs.mkdir(localDir, { recursive: true });

    await fs.writeFile(path.join(globalDir, 'a.md'), '---\nname: a\ndescription: global a\n---\nGlobal A');
    await fs.writeFile(path.join(globalDir, 'b.md'), 'B global');
    await fs.writeFile(path.join(localDir, 'b.md'), '---\nname: b\ndescription: local b\n---\nLocal B');

    // Monkey patch homedir to point to tmp for this test by creating ~/.atlas/commands structure
    const homeAtlas = path.join(tmp, '.atlas', 'commands');
    await fs.mkdir(homeAtlas, { recursive: true });
    await fs.writeFile(path.join(homeAtlas, 'a.md'), '---\nname: a\ndescription: home a\n---\nHome A');

    // We'll call loadCommands with cwd = tmp/localProject, and create .atlas/commands there
    const cwd = path.join(tmp, 'project');
    await fs.mkdir(path.join(cwd, '.atlas', 'commands'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.atlas', 'commands', 'b.md'), '---\nname: b\ndescription: project b\n---\nProject B');

    // Now temporarily set HOME to tmp so loadCommands reads home atlas
    const oldHome = process.env.HOME;
    process.env.HOME = tmp;

    const cmds = await loadCommands(cwd);

    // restore
    process.env.HOME = oldHome;

    // Expect commands a and b
    const names = cmds.map((c) => c.name).sort();
    expect(names).toEqual(['a', 'b']);

    const a = cmds.find((c) => c.name === 'a');
    expect(a.source.endsWith('a.md')).toBeTruthy();

    const b = cmds.find((c) => c.name === 'b');
    expect(b.description).toBe('project b');
  });
});
