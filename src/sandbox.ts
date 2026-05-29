import { platform } from "node:os";

export interface SandboxOptions {
  timeout: number;
  networkAccess: boolean;
  readonlyPaths: string[];
  maxMemoryMB: number;
}

const DEFAULT_OPTIONS: SandboxOptions = {
  timeout: 30,
  networkAccess: true,
  readonlyPaths: ["/usr", "/bin", "/lib", "/etc"],
  maxMemoryMB: 512,
};

export function wrapCommand(command: string, options?: Partial<SandboxOptions>): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const os = platform();

  if (os === "linux") {
    const parts: string[] = [];
    parts.push(`timeout ${opts.timeout}`);
    parts.push(`bash -c 'ulimit -v ${opts.maxMemoryMB * 1024}; ${command.replace(/'/g, "'\\''")}'`);
    return parts.join(" ");
  }

  if (os === "darwin") {
    return `timeout ${opts.timeout} bash -c '${command.replace(/'/g, "'\\''")}'`;
  }

  return command;
}

export function getSandboxConfig(): SandboxOptions {
  return { ...DEFAULT_OPTIONS };
}
