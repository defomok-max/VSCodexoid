import type { McpToolDescriptor } from "../../shared/types";
import type { ToolRegistry } from "../tools/toolRegistry";
import { buildMcpToolDefinition, isMcpToolId, mcpToolId, type McpCallBridge } from "./mcpToolAdapter";

/**
 * Diffs the next set of MCP tool descriptors against what is currently
 * registered and applies the minimal `register` / `unregister` calls to
 * make the registry match.
 *
 * Returns the counts so the host can log a one-line summary.
 */
export function reconcileMcpTools(
  registry: ToolRegistry,
  next: ReadonlyArray<McpToolDescriptor>,
  bridge: McpCallBridge,
): { added: number; removed: number; kept: number } {
  const desiredIds = new Set(next.map((d) => mcpToolId(d.serverId, d.name)));
  const currentIds = new Set(registry.idsStartingWith("mcp:"));

  let removed = 0;
  for (const id of currentIds) {
    if (!desiredIds.has(id) && isMcpToolId(id)) {
      registry.unregister(id);
      removed++;
    }
  }

  let added = 0;
  let kept = 0;
  for (const d of next) {
    const id = mcpToolId(d.serverId, d.name);
    if (currentIds.has(id)) {
      kept++;
      continue;
    }
    registry.register(buildMcpToolDefinition(d, bridge));
    added++;
  }

  return { added, removed, kept };
}
