import { ToolRegistry } from "../tools/registry.js";

export class PlanMode {
  private active = false;

  isActive(): boolean {
    return this.active;
  }

  enter(): void {
    this.active = true;
  }

  exit(): void {
    this.active = false;
  }

  filterRegistry(registry: ToolRegistry): ToolRegistry {
    const filtered = new ToolRegistry();
    for (const tool of registry.getAll()) {
      if (!tool.isDestructive) {
        filtered.register(tool);
      }
    }
    return filtered;
  }
}
