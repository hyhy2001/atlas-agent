import { promises as fs } from "node:fs";
import path from "node:path";
import { parseCron, nextFireTime, type CronFields } from "./parser.js";

export interface CronJob {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  durable: boolean;
  createdAt: string;
  nextFireAt: string;
  lastFiredAt?: string;
}

interface StoreData {
  nextId?: number;
  jobs?: CronJob[];
}

export class CronScheduler {
  private jobs = new Map<string, CronJob>();
  private fieldsCache = new Map<string, CronFields>();
  private nextId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fireHandler: ((job: CronJob) => void | Promise<void>) | null = null;

  constructor(private storePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.storePath, "utf8");
      const data = JSON.parse(raw) as StoreData;
      this.jobs.clear();
      this.fieldsCache.clear();
      this.nextId = data.nextId ?? 1;
      for (const job of data.jobs ?? []) {
        try {
          const fields = parseCron(job.cron);
          this.jobs.set(job.id, job);
          this.fieldsCache.set(job.id, fields);
        } catch {
          // ignore invalid persisted jobs
        }
      }
    } catch {
      // no durable cron store yet
    }
  }

  async saveDurable(): Promise<void> {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    const jobs = Array.from(this.jobs.values()).filter((job) => job.durable);
    await fs.writeFile(this.storePath, JSON.stringify({ nextId: this.nextId, jobs }, null, 2), "utf8");
  }

  onFire(handler: (job: CronJob) => void | Promise<void>): void {
    this.fireHandler = handler;
  }

  add(input: { cron: string; prompt: string; recurring?: boolean; durable?: boolean }): CronJob {
    const fields = parseCron(input.cron);
    const now = new Date();
    const job: CronJob = {
      id: String(this.nextId++),
      cron: input.cron,
      prompt: input.prompt,
      recurring: input.recurring ?? true,
      durable: input.durable ?? true,
      createdAt: now.toISOString(),
      nextFireAt: nextFireTime(fields, now).toISOString(),
    };
    this.jobs.set(job.id, job);
    this.fieldsCache.set(job.id, fields);
    if (job.durable) this.saveDurable().catch(() => {});
    return job;
  }

  remove(id: string): boolean {
    const existed = this.jobs.delete(id);
    this.fieldsCache.delete(id);
    if (existed) this.saveDurable().catch(() => {});
    return existed;
  }

  list(): CronJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => a.nextFireAt.localeCompare(b.nextFireAt));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, 30_000);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now: Date = new Date()): Promise<void> {
    let shouldSave = false;
    for (const job of Array.from(this.jobs.values())) {
      if (new Date(job.nextFireAt) > now) continue;

      if (this.fireHandler) {
        try {
          await this.fireHandler(job);
        } catch {
          // keep processing remaining due jobs
        }
      }

      job.lastFiredAt = now.toISOString();
      if (job.recurring) {
        let fields = this.fieldsCache.get(job.id);
        if (!fields) {
          fields = parseCron(job.cron);
          this.fieldsCache.set(job.id, fields);
        }
        job.nextFireAt = nextFireTime(fields, now).toISOString();
      } else {
        this.jobs.delete(job.id);
        this.fieldsCache.delete(job.id);
      }
      if (job.durable) shouldSave = true;
    }
    if (shouldSave) await this.saveDurable();
  }
}

let _instance: CronScheduler | null = null;
export function getCronScheduler(storePath?: string): CronScheduler {
  if (!_instance) {
    _instance = new CronScheduler(storePath ?? path.join(process.cwd(), ".atlas", "cron.json"));
  }
  return _instance;
}
