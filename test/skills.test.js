import { describe, it, expect } from 'vitest';
import { parseSkillFile, loadSkills, formatSkillsForSystemPrompt } from '../src/skills.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('parseSkillFile', () => {
  it('parses frontmatter name and description', () => {
    const content = `---\nname: my-skill\ndescription: Does a thing\n---\n\nDo the thing`;
    const s = parseSkillFile(content, '/tmp/my-skill.md');
    expect(s.name).toBe('my-skill');
    expect(s.description).toBe('Does a thing');
    expect(s.promptBody).toBe('Do the thing');
  });

  it('parses args array', () => {
    const content = `---\nname: x\ndescription: y\nargs: [interval, prompt]\n---\nbody`;
    const s = parseSkillFile(content, '/tmp/x.md');
    expect(s.args).toEqual(['interval', 'prompt']);
  });

  it('falls back to filename when no frontmatter', () => {
    const content = `Just a body, no frontmatter`;
    const s = parseSkillFile(content, '/tmp/fallback.md');
    expect(s.name).toBe('fallback');
    expect(s.description).toBe('');
    expect(s.promptBody).toBe('Just a body, no frontmatter');
  });
});

describe('loadSkills', () => {
  it('loads bundled skills', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-skills-'));
    const skills = await loadSkills(tmp);
    const names = skills.map(s => s.name);
    expect(names).toContain('loop');
    expect(names).toContain('remember');
    expect(names).toContain('simplify');
    expect(names).toContain('debug');
  });

  it('project-local skill overrides bundled by name', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-skills-'));
    const localDir = path.join(tmp, '.atlas', 'skills');
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(path.join(localDir, 'loop.md'), `---\nname: loop\ndescription: OVERRIDDEN\n---\noverride body`);
    const skills = await loadSkills(tmp);
    const loop = skills.find(s => s.name === 'loop');
    expect(loop?.description).toBe('OVERRIDDEN');
  });

  it('loads a custom local skill', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-skills-'));
    const localDir = path.join(tmp, '.atlas', 'skills');
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(path.join(localDir, 'scan-rtl.md'), `---\nname: scan-rtl\ndescription: Scan RTL files\n---\nScan the files`);
    const skills = await loadSkills(tmp);
    expect(skills.find(s => s.name === 'scan-rtl')).toBeTruthy();
  });
});

describe('formatSkillsForSystemPrompt', () => {
  it('returns empty string for no skills', () => {
    expect(formatSkillsForSystemPrompt([])).toBe('');
  });

  it('includes skill name, description and body', () => {
    const out = formatSkillsForSystemPrompt([
      { name: 'foo', description: 'bar', promptBody: 'do stuff', source: 'x' },
    ]);
    expect(out).toContain('/foo');
    expect(out).toContain('bar');
    expect(out).toContain('do stuff');
  });
});
