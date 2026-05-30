import { describe, it, expect } from 'vitest';
import { TeamManager } from '../src/coordinator/team.js';

describe('TeamManager', () => {
  it('creates a team with members', () => {
    const mgr = new TeamManager();
    const team = mgr.create('rtl-team', [
      { name: 'reviewer', profile: 'atlas-forge' },
      { name: 'fixer', profile: 'atlas-swift' },
    ]);
    expect(team.name).toBe('rtl-team');
    expect(team.members.size).toBe(2);
    expect(team.members.get('reviewer')?.profile).toBe('atlas-forge');
  });

  it('throws on duplicate team name', () => {
    const mgr = new TeamManager();
    mgr.create('dup', [{ name: 'a', profile: 'atlas-forge' }]);
    expect(() => mgr.create('dup', [{ name: 'b', profile: 'atlas-forge' }])).toThrow();
  });

  it('lists teams', () => {
    const mgr = new TeamManager();
    mgr.create('t1', [{ name: 'a', profile: 'atlas-forge' }]);
    mgr.create('t2', [{ name: 'b', profile: 'atlas-swift' }]);
    expect(mgr.list()).toHaveLength(2);
  });

  it('deletes a team', () => {
    const mgr = new TeamManager();
    mgr.create('del-me', [{ name: 'x', profile: 'atlas-forge' }]);
    expect(mgr.delete('del-me')).toBe(true);
    expect(mgr.get('del-me')).toBeNull();
    expect(mgr.delete('del-me')).toBe(false);
  });

  it('sends message to member mailbox', () => {
    const mgr = new TeamManager();
    mgr.create('msg-team', [{ name: 'worker', profile: 'atlas-forge' }]);
    mgr.sendMessage('msg-team', 'worker', 'Hello worker');
    const member = mgr.get('msg-team')?.members.get('worker');
    expect(member?.mailbox).toContain('Hello worker');
  });

  it('throws on send to unknown team', () => {
    const mgr = new TeamManager();
    expect(() => mgr.sendMessage('no-team', 'x', 'hi')).toThrow('not found');
  });

  it('throws on send to unknown member', () => {
    const mgr = new TeamManager();
    mgr.create('t', [{ name: 'a', profile: 'atlas-forge' }]);
    expect(() => mgr.sendMessage('t', 'nobody', 'hi')).toThrow('not found');
  });
});
