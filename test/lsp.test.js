import { describe, it, expect } from 'vitest';
import { serverForFile, findProjectRoot, SERVERS } from '../src/lsp/servers.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('serverForFile', () => {
  it('returns typescript config for .ts files', () => {
    const cfg = serverForFile('src/foo.ts');
    expect(cfg).not.toBeNull();
    expect(cfg.language).toBe('typescript');
    expect(cfg.command).toBe('typescript-language-server');
  });

  it('returns typescript config for .tsx files', () => {
    const cfg = serverForFile('Component.tsx');
    expect(cfg).not.toBeNull();
    expect(cfg.language).toBe('typescript');
  });

  it('returns javascript config for .js files', () => {
    const cfg = serverForFile('index.js');
    expect(cfg).not.toBeNull();
    expect(cfg.language).toBe('javascript');
  });

  it('returns python config for .py files', () => {
    const cfg = serverForFile('main.py');
    expect(cfg).not.toBeNull();
    expect(cfg.language).toBe('python');
  });

  it('returns c config for .c files', () => {
    const cfg = serverForFile('main.c');
    expect(cfg).not.toBeNull();
    expect(cfg.language).toBe('c');
  });

  it('returns cpp config for .cpp files', () => {
    const cfg = serverForFile('module.cpp');
    expect(cfg).not.toBeNull();
    expect(cfg.language).toBe('cpp');
  });

  it('returns verilog config for .sv files', () => {
    const cfg = serverForFile('counter.sv');
    expect(cfg).not.toBeNull();
    expect(cfg.language).toBe('verilog');
  });

  it('returns verilog config for .v files', () => {
    const cfg = serverForFile('adder.v');
    expect(cfg).not.toBeNull();
    expect(cfg.language).toBe('verilog');
  });

  it('returns null for unknown extension', () => {
    expect(serverForFile('file.unknown')).toBeNull();
    expect(serverForFile('file.go')).toBeNull();
    expect(serverForFile('Makefile')).toBeNull();
  });
});

describe('findProjectRoot', () => {
  it('finds root by marker file', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-lsp-'));
    fs.writeFileSync(path.join(tmp, 'tsconfig.json'), '{}');
    const subdir = path.join(tmp, 'src', 'utils');
    fs.mkdirSync(subdir, { recursive: true });
    const filePath = path.join(subdir, 'helper.ts');
    fs.writeFileSync(filePath, '');
    const root = findProjectRoot(filePath, ['tsconfig.json', '.git']);
    expect(root).toBe(tmp);
    fs.rmSync(tmp, { recursive: true });
  });

  it('falls back to file directory when no marker found', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-lsp-'));
    const filePath = path.join(tmp, 'orphan.ts');
    fs.writeFileSync(filePath, '');
    const root = findProjectRoot(filePath, ['__atlas_no_marker_1__', '__atlas_no_marker_2__']);
    expect(root).toBe(tmp);
    fs.rmSync(tmp, { recursive: true });
  });
});

describe('SERVERS config', () => {
  it('all servers have required fields', () => {
    for (const s of SERVERS) {
      expect(s.language).toBeTruthy();
      expect(s.extensions.length).toBeGreaterThan(0);
      expect(s.command).toBeTruthy();
      expect(Array.isArray(s.args)).toBe(true);
      expect(s.rootMarkers.length).toBeGreaterThan(0);
    }
  });

  it('typescript and javascript share the same command', () => {
    const ts = SERVERS.find(s => s.language === 'typescript');
    const js = SERVERS.find(s => s.language === 'javascript');
    expect(ts?.command).toBe(js?.command);
  });

  it('c and cpp share clangd', () => {
    const c = SERVERS.find(s => s.language === 'c');
    const cpp = SERVERS.find(s => s.language === 'cpp');
    expect(c?.command).toBe('clangd');
    expect(cpp?.command).toBe('clangd');
  });
});
