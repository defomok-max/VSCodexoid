import type { McpServerConfig } from "../../shared/types";
import type { McpManager } from "./mcpManager";

/**
 * Diffs the desired set of MCP servers against what the manager already has
 * running, and applies the minimum number of `startServer` / `stopServer`
 * calls. Returns a count of operations performed so the host can log a
 * one-line summary.
 *
 * Rules:
 *  - A server is **runnable** when both `enabled` and `autoStart !== false`.
 *  - For each runnable desired server, if a client with the same `id` is
 *    not running we `startServer(cfg)`. (If a client is already running we
 *    leave it alone here \u2014 use `restartServer` for explicit cycle.)
 *  - For each currently-running client whose id is no longer in the
 *    runnable set, we `stopServer(id)`.
 */
export async function reconcileMcpLifecycle(
  manager: McpManager,
  desired: ReadonlyArray<McpServerConfig>,
): Promise<{ started: number; stopped: number }> {
  const runnable = desired.filter(isRunnable);
  const desiredIds = new Set(runnable.map((s) => s.id));

  let started = 0;
  let stopped = 0;

  // Stop clients that should no longer be running.
  const runningIds = manager.runningServerIds();
  for (const id of runningIds) {
    if (!desiredIds.has(id)) {
      await manager.stopServer(id);
      stopped++;
    }
  }

  // Start clients that should be running but aren't.
  for (const cfg of runnable) {
    if (manager.getClient(cfg.id)?.isRunning()) continue;
    await manager.startServer(cfg);
    started++;
  }

  return { started, stopped };
}

/**
 * Restart a single server by id: stop (if running) then start with the
 * given config. Used by the `mcp/restart` UI action.
 */
export async function restartMcpServer(manager: McpManager, cfg: McpServerConfig): Promise<void> {
  await manager.stopServer(cfg.id);
  if (isRunnable(cfg)) await manager.startServer(cfg);
}

function isRunnable(cfg: McpServerConfig): boolean {
  return !!cfg.enabled && cfg.autoStart !== false;
}
