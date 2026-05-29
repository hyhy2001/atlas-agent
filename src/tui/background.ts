import { spawn, ChildProcess } from "node:child_process";

export interface BackgroundJob {
  id: string;
  command: string;
  startedAt: number;
  status: "running" | "done" | "killed";
  exitCode?: number;
  output: string;
  child?: ChildProcess;
}

const jobs = new Map<string, BackgroundJob>();
let nextId = 1;

export function startJob(command: string, cwd: string): BackgroundJob {
  const id = String(nextId++);
  const child = spawn(command, { shell: true, cwd, stdio: ["ignore", "pipe", "pipe"] });
  const job: BackgroundJob = {
    id,
    command,
    startedAt: Date.now(),
    status: "running",
    output: "",
    child,
  };
  child.stdout?.on("data", (d) => { job.output += d.toString(); });
  child.stderr?.on("data", (d) => { job.output += d.toString(); });
  child.on("close", (code) => {
    job.status = job.status === "killed" ? "killed" : "done";
    job.exitCode = code ?? -1;
    job.child = undefined;
  });
  jobs.set(id, job);
  return job;
}

export function listJobs(): BackgroundJob[] {
  return Array.from(jobs.values()).sort((a, b) => Number(a.id) - Number(b.id));
}

export function getJob(id: string): BackgroundJob | undefined {
  return jobs.get(id);
}

export function killJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.status !== "running") return false;
  job.child?.kill("SIGTERM");
  job.status = "killed";
  return true;
}

export function formatJob(j: BackgroundJob): string {
  const elapsed = Math.floor((Date.now() - j.startedAt) / 1000);
  const time = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const statusLabel = j.status === "running" ? "⠿ running" : j.status === "done" ? `✓ exit ${j.exitCode}` : "✗ killed";
  return `[${j.id}] ${statusLabel} · ${time} · ${j.command.slice(0, 60)}`;
}
