const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[rfRF]+\s+|--recursive|--force)/, reason: "rm with -r/-f flags" },
  { pattern: /\bsed\s+(-i\b|-i\s|-i'|-i")/, reason: "sed -i (in-place edit)" },
  { pattern: />\s*(?!\/dev\/null|\/dev\/stderr|&\d)/, reason: "redirect that overwrites a file" },
  { pattern: /\bchmod\s+(-R|-r|--recursive)/, reason: "chmod -R" },
  { pattern: /\bchown\s+(-R|-r|--recursive)/, reason: "chown -R" },
  { pattern: /\bdd\s/, reason: "dd command" },
  { pattern: /\bmkfs\b/, reason: "filesystem creation" },
  { pattern: /\bkill(all)?\s+(-9|-KILL)/, reason: "force kill" },
  { pattern: /\bmv\s+\S+\s+\S+/, reason: "mv (rename/move)" },
  { pattern: /\bgit\s+reset\s+--hard/, reason: "git reset --hard" },
  { pattern: /\bgit\s+push\s+(.+\s)?--force/, reason: "git push --force" },
  { pattern: /\bgit\s+clean\s+-[fF]/, reason: "git clean -f" },
  { pattern: /\bgit\s+checkout\s+\.\s*$/, reason: "git checkout . (discard changes)" },
  { pattern: /\bdrop\s+(table|database)\b/i, reason: "SQL DROP statement" },
  { pattern: /:\(\)\s*\{.*\|\s*:.*\}.*:/, reason: "fork bomb" },
];

// Catastrophic removal targets — rm targeting root, home, or system dirs
const DANGEROUS_REMOVAL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\b.*\s(\/\s*$|\/\s+"|\/ )/, reason: "rm targeting filesystem root (/)" },
  { pattern: /\brm\b.*\s~\s*$/, reason: "rm targeting home directory (~)" },
  { pattern: /\brm\b.*\s~\/\s*$/, reason: "rm targeting home directory (~/)" },
  { pattern: /\brm\b.*\s\/tmp\s*$/, reason: "rm targeting /tmp" },
  { pattern: /\brm\b.*\s\/etc\b/, reason: "rm targeting /etc" },
  { pattern: /\brm\b.*\s\/usr\b/, reason: "rm targeting /usr" },
  { pattern: /\brm\b.*\s\/var\b/, reason: "rm targeting /var" },
  { pattern: /\brm\b.*\s\/home\b/, reason: "rm targeting /home" },
  { pattern: /\brm\b.*\s\/root\b/, reason: "rm targeting /root" },
  { pattern: /\brm\b.*\s\*\s*$/, reason: "rm with bare wildcard (*)" },
];

// Shell expansion characters in path arguments — can bypass literal path validation
const SHELL_EXPANSION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\$[{(]/, reason: "shell variable expansion in path (${VAR} or $(cmd))" },
  { pattern: /(?<!\$)\$[A-Za-z_]/, reason: "shell variable in path ($VAR)" },
  { pattern: /~[A-Za-z]/, reason: "tilde user expansion in path (~user)" },
  { pattern: /%[A-Za-z_][A-Za-z_0-9]*%/, reason: "Windows environment variable in path (%VAR%)" },
];

export function detectDestructive(command: string): { destructive: boolean; reason?: string } {
  // Check catastrophic removal targets first — more specific, better message
  for (const { pattern, reason } of DANGEROUS_REMOVAL_PATTERNS) {
    if (pattern.test(command)) {
      return { destructive: true, reason };
    }
  }
  for (const { pattern, reason } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return { destructive: true, reason };
    }
  }
  return { destructive: false };
}

// Warn (but don't block) when shell expansion characters appear in commands
// that look like file operations — caller decides whether to prompt
export function detectShellExpansion(command: string): { suspicious: boolean; reason?: string } {
  // Only flag if command looks like a file operation
  if (!/\b(rm|mv|cp|cat|chmod|chown|ln|touch|mkdir|rmdir|find|ls|stat|open|read|write|edit)\b/.test(command)) {
    return { suspicious: false };
  }
  for (const { pattern, reason } of SHELL_EXPANSION_PATTERNS) {
    if (pattern.test(command)) {
      return { suspicious: true, reason };
    }
  }
  return { suspicious: false };
}

// Denial circuit breaker — tracks consecutive permission denials per session.
// After threshold, the agent should stop retrying and ask the user instead.
const denialCounts = new Map<string, number>();
const DENIAL_THRESHOLD = 3;

export function recordDenial(sessionId: string): void {
  denialCounts.set(sessionId, (denialCounts.get(sessionId) ?? 0) + 1);
}

export function resetDenials(sessionId: string): void {
  denialCounts.delete(sessionId);
}

export function isDenialCircuitOpen(sessionId: string): boolean {
  return (denialCounts.get(sessionId) ?? 0) >= DENIAL_THRESHOLD;
}
