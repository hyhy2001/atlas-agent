import { describe, it, expect } from 'vitest';
import {
  getRoleSection,
  getToneSection,
  getActionsCareSection,
  getCyberRiskSection,
  getNumericLengthAnchorsSection,
  getFaithfulReportingSection,
  getMcpInstructionsSection,
  getWorkedExampleSection,
  getEnvSection,
  DYNAMIC_BOUNDARY,
} from '../src/agent/prompt_sections.js';
import { buildLeaderPrompt } from '../src/agent/system_prompt.js';

describe('getRoleSection', () => {
  it('leader describes orchestrator role', () => {
    const s = getRoleSection('leader');
    expect(s).toContain('Leader');
    expect(s).toContain('delegate');
    expect(s).toContain('atlas-swift');
  });
  it('atlas-swift is mechanical', () => {
    expect(getRoleSection('atlas-swift')).toContain('mechanical');
  });
  it('atlas-forge mentions MCP tools', () => {
    const s = getRoleSection('atlas-forge');
    expect(s).toContain('search_graph');
    expect(s).toContain('get_code_snippet');
  });
  it('atlas-deep mentions root cause', () => {
    expect(getRoleSection('atlas-deep')).toContain('root cause');
  });
});

describe('getToneSection', () => {
  it('includes file:line and no-emoji rules', () => {
    const s = getToneSection();
    expect(s).toContain('file_path:line_number');
    expect(s).toContain('emoji');
  });
});

describe('getActionsCareSection', () => {
  it('covers reversibility and destructive ops', () => {
    const s = getActionsCareSection();
    expect(s).toContain('blast radius');
    expect(s).toContain('git reset --hard');
    expect(s).toContain('--no-verify');
  });
});

describe('getCyberRiskSection', () => {
  it('refuses destructive/DoS but allows defensive', () => {
    const s = getCyberRiskSection();
    expect(s).toContain('Refuse requests for destructive');
    expect(s).toContain('defensive');
  });
});

describe('getNumericLengthAnchorsSection', () => {
  it('caps narration words', () => {
    expect(getNumericLengthAnchorsSection()).toContain('25 words');
  });
});

describe('getFaithfulReportingSection', () => {
  it('requires real verification', () => {
    const s = getFaithfulReportingSection();
    expect(s).toContain('verbatim');
  });
});

describe('getMcpInstructionsSection', () => {
  it('returns empty when no connected servers', () => {
    expect(getMcpInstructionsSection([])).toBe('');
    expect(getMcpInstructionsSection(undefined)).toBe('');
  });
  it('lists connected servers', () => {
    const s = getMcpInstructionsSection([{ name: 'codebase-memory', status: 'connected', toolCount: 14 }]);
    expect(s).toContain('codebase-memory');
    expect(s).toContain('14 tools');
  });
  it('skips failed servers', () => {
    const s = getMcpInstructionsSection([{ name: 'broken', status: 'failed', toolCount: 0 }]);
    expect(s).toBe('');
  });
});

describe('getWorkedExampleSection', () => {
  it('only renders for leader', () => {
    expect(getWorkedExampleSection('leader')).toContain('Delegating Well');
    expect(getWorkedExampleSection('atlas-forge')).toBe('');
  });
});

describe('getEnvSection', () => {
  it('includes cwd, platform, date', () => {
    const s = getEnvSection({ model: 'test-model' });
    expect(s).toContain('Working directory');
    expect(s).toContain('Platform:');
    expect(s).toContain('test-model');
  });
});

describe('buildLeaderPrompt', () => {
  it('assembles all sections with dynamic boundary', () => {
    const p = buildLeaderPrompt({ model: 'm' });
    expect(p).toContain('Leader');
    expect(p).toContain('file_path:line_number');
    expect(p).toContain('Refuse requests for destructive');
    expect(p).toContain(DYNAMIC_BOUNDARY.trim());
    expect(p).toContain('Working directory');
    // Static content must come before the dynamic boundary
    const boundaryIdx = p.indexOf('ATLAS_DYNAMIC_BOUNDARY');
    expect(p.indexOf('file_path:line_number')).toBeLessThan(boundaryIdx);
    expect(p.indexOf('Working directory')).toBeGreaterThan(boundaryIdx);
  });
});
