import { promises as fs } from "node:fs";
import path from "node:path";

export interface Task {
  id: string;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  activeForm?: string;
  owner?: string;
  blocks: string[];
  blockedBy: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TaskUpdatePatch {
  status?: Task["status"];
  subject?: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  addBlocks?: string[];
  addBlockedBy?: string[];
  metadata?: Record<string, unknown>;
}

export class TaskStore {
  private tasks = new Map<string, Task>();
  private nextId = 1;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private storePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.storePath, "utf8");
      const data = JSON.parse(raw) as { nextId: number; tasks: Task[] };
      this.nextId = data.nextId ?? 1;
      this.tasks.clear();
      for (const t of data.tasks ?? []) {
        this.tasks.set(t.id, t);
      }
    } catch {
      // file doesn't exist yet — start fresh
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.save().catch(() => {}); }, 300);
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    const data = { nextId: this.nextId, tasks: Array.from(this.tasks.values()) };
    await fs.writeFile(this.storePath, JSON.stringify(data, null, 2), "utf8");
  }

  create(input: { subject: string; description: string; activeForm?: string; metadata?: Record<string, unknown> }): Task {
    const id = String(this.nextId++);
    const now = new Date().toISOString();
    const task: Task = {
      id,
      subject: input.subject,
      description: input.description,
      status: "pending",
      activeForm: input.activeForm,
      owner: undefined,
      blocks: [],
      blockedBy: [],
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    this.scheduleSave();
    return task;
  }

  get(id: string): Task | null {
    return this.tasks.get(id) ?? null;
  }

  list(): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.status !== "deleted");
  }

  update(id: string, patch: TaskUpdatePatch): Task | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (patch.status !== undefined) task.status = patch.status;
    if (patch.subject !== undefined) task.subject = patch.subject;
    if (patch.description !== undefined) task.description = patch.description;
    if (patch.activeForm !== undefined) task.activeForm = patch.activeForm;
    if (patch.owner !== undefined) task.owner = patch.owner;
    if (patch.addBlocks?.length) {
      for (const b of patch.addBlocks) {
        if (!task.blocks.includes(b)) task.blocks.push(b);
        const other = this.tasks.get(b);
        if (other && !other.blockedBy.includes(id)) other.blockedBy.push(id);
      }
    }
    if (patch.addBlockedBy?.length) {
      for (const b of patch.addBlockedBy) {
        if (!task.blockedBy.includes(b)) task.blockedBy.push(b);
        const other = this.tasks.get(b);
        if (other && !other.blocks.includes(id)) other.blocks.push(id);
      }
    }
    if (patch.metadata !== undefined) {
      task.metadata = { ...(task.metadata ?? {}), ...patch.metadata };
    }
    task.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return task;
  }

  delete(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    task.status = "deleted";
    task.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return true;
  }
}

const stores = new Map<string, TaskStore>();

export async function getTaskStore(workingDir: string): Promise<TaskStore> {
  let store = stores.get(workingDir);
  if (!store) {
    const storePath = path.join(workingDir, ".atlas", "tasks.json");
    store = new TaskStore(storePath);
    await store.load();
    stores.set(workingDir, store);
  }
  return store;
}
