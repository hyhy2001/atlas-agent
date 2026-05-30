import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectDestructive,
  detectShellExpansion,
  recordDenial,
  resetDenials,
  isDenialCircuitOpen,
} from '../src/tools/builtin/bash_safety.js';

describe('detectDestructive — existing patterns', () => {
  it('flags rm -rf', () => {
    expect(detectDestructive('rm -rf node_modules').destructive).toBe(true);
  });
  it('does not flag plain rm', () => {
    expect(detectDestructive('rm file.txt').destructive).toBe(false);
  });
});

describe('detectDestructive — dangerous removal targets', () => {
  it('flags rm targeting filesystem root', () => {
    const r = detectDestructive('rm -rf / ');
    expect(r.destructive).toBe(true);
    expect(r.reason).toContain('root');
  });
  it('flags rm targeting home directory', () => {
    expect(detectDestructive('rm -rf ~').destructive).toBe(true);
    expect(detectDestructive('rm -rf ~/').destructive).toBe(true);
  });
  it('flags rm targeting /tmp', () => {
    expect(detectDestructive('rm -rf /tmp').destructive).toBe(true);
  });
  it('flags rm targeting /etc, /usr, /var, /home, /root', () => {
    expect(detectDestructive('rm -rf /etc/passwd').destructive).toBe(true);
    expect(detectDestructive('rm -rf /usr/local').destructive).toBe(true);
    expect(detectDestructive('rm -rf /var').destructive).toBe(true);
    expect(detectDestructive('rm -rf /home/foo').destructive).toBe(true);
    expect(detectDestructive('rm -rf /root').destructive).toBe(true);
  });
  it('flags rm with bare wildcard', () => {
    expect(detectDestructive('rm -rf *').destructive).toBe(true);
  });
});

describe('detectShellExpansion', () => {
  it('flags $VAR in rm command', () => {
    const r = detectShellExpansion('rm $TARGET_DIR');
    expect(r.suspicious).toBe(true);
    expect(r.reason).toContain('$VAR');
  });
  it('flags ${VAR} in mv', () => {
    expect(detectShellExpansion('mv ${SRC} dest').suspicious).toBe(true);
  });
  it('flags $(cmd) substitution', () => {
    expect(detectShellExpansion('rm $(find . -type f)').suspicious).toBe(true);
  });
  it('flags ~user expansion', () => {
    expect(detectShellExpansion('cp file ~alice/dest').suspicious).toBe(true);
  });
  it('flags Windows %VAR% in chmod', () => {
    expect(detectShellExpansion('chmod 644 %APPDATA%').suspicious).toBe(true);
  });
  it('does not flag shell expansion in non-file commands', () => {
    expect(detectShellExpansion('echo $HOME').suspicious).toBe(false);
    expect(detectShellExpansion('npm install $PACKAGE').suspicious).toBe(false);
  });
  it('does not flag commands without expansion', () => {
    expect(detectShellExpansion('rm -rf node_modules').suspicious).toBe(false);
  });
});

describe('denial circuit breaker', () => {
  beforeEach(() => {
    resetDenials('test-session');
  });
  it('opens circuit after 3 consecutive denials', () => {
    expect(isDenialCircuitOpen('test-session')).toBe(false);
    recordDenial('test-session');
    recordDenial('test-session');
    expect(isDenialCircuitOpen('test-session')).toBe(false);
    recordDenial('test-session');
    expect(isDenialCircuitOpen('test-session')).toBe(true);
  });
  it('reset clears the circuit', () => {
    recordDenial('s1');
    recordDenial('s1');
    recordDenial('s1');
    expect(isDenialCircuitOpen('s1')).toBe(true);
    resetDenials('s1');
    expect(isDenialCircuitOpen('s1')).toBe(false);
  });
  it('tracks per-session independently', () => {
    recordDenial('a');
    recordDenial('a');
    recordDenial('a');
    expect(isDenialCircuitOpen('a')).toBe(true);
    expect(isDenialCircuitOpen('b')).toBe(false);
  });
});
