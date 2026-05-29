import { resolve } from "node:path";

export function isTrustedPath(filePath: string, trustedDirs: string[], cwd: string): boolean {
  const absPath = resolve(cwd, filePath);
  return trustedDirs.some((dir) => {
    const absDir = resolve(cwd, dir);
    return absPath.startsWith(absDir);
  });
}
