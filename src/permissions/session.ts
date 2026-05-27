import type { SessionPermissions } from "../tools/types.js";

export class PermissionSession implements SessionPermissions {
  private grants = new Map<string, true>();

  check(toolName: string): boolean {
    return this.grants.has(toolName);
  }

  grant(toolName: string): void {
    this.grants.set(toolName, true);
  }
}
