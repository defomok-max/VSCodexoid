import type { ToolDefinition } from "./toolTypes";

/**
 * Registry of `ToolDefinition`s. The agent runner consults this to discover
 * which tools to expose to the LLM (after filtering by mode / skill /
 * MCP allow-lists), validate arguments, and dispatch execution.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register<I extends Record<string, unknown>>(t: ToolDefinition<I>): void {
    if (this.tools.has(t.id)) {
      throw new Error(`tool ${t.id} already registered`);
    }
    this.tools.set(t.id, t as ToolDefinition);
  }

  /**
   * Removes a tool by id. Returns `true` if the tool was registered and is
   * now removed, `false` if it was never registered. Used by the MCP layer
   * to drop tools when a server stops or its tool list changes.
   */
  unregister(id: string): boolean {
    return this.tools.delete(id);
  }

  /**
   * Returns the ids of tools whose ids start with the given prefix. Used by
   * the MCP layer to enumerate tools synthesised for a given server.
   */
  idsStartingWith(prefix: string): string[] {
    const out: string[] = [];
    for (const id of this.tools.keys()) {
      if (id.startsWith(prefix)) out.push(id);
    }
    return out;
  }

  get(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }

  list(filter?: { categories?: string[]; allowed?: string[] | "*" }): ToolDefinition[] {
    let xs = [...this.tools.values()];
    if (filter?.categories?.length) {
      xs = xs.filter((t) => filter.categories!.includes(t.category));
    }
    if (filter?.allowed && filter.allowed !== "*") {
      const set = new Set(filter.allowed);
      xs = xs.filter((t) => set.has(t.id));
    }
    return xs;
  }

  ids(): string[] {
    return [...this.tools.keys()];
  }
}
