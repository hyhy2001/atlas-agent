import { describe, it, expect } from 'vitest';
import { PermissionSession } from '../src/permissions/session.js';

describe('PermissionSession', () => {
  it('initially denies tools and grants after grant()', () => {
    const s = new PermissionSession();
    expect(s.check('read_file')).toBe(false);
    s.grant('read_file');
    expect(s.check('read_file')).toBe(true);
  });
});
