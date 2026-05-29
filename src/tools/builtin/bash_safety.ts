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

export function detectDestructive(command: string): { destructive: boolean; reason?: string } {
  for (const { pattern, reason } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return { destructive: true, reason };
    }
  }
  return { destructive: false };
}
