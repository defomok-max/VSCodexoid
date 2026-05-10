import { describe, expect, it } from "vitest";
import { reconcileMcpLifecycle, restartMcpServer } from "../src/core/mcp/mcpLifecycle";
import { mergeServers, isMcpServerConfig, normalizeMcpServerList } from "../src/core/storage/mcpConfigStore";
import type { McpServerConfig } from "../src/shared/types";
import type { McpClient } from "../src/core/mcp/mcpManager";
import { McpManager } from "../src/core/mcp/mcpManager";

function cfg(id: string, extras: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id,
    name: id,
    type: "stdio",
    command: "echo",
    args: [],
    enabled: true,
    ...extras,
  };
}

/**
 * Builds a McpManager pre-seeded with fake clients keyed by id. Lets us
 * assert what the lifecycle reconciler does without spawning real
 * subprocesses.
 */
function makeManager(running: ReadonlyArray<string>): {
  manager: McpManager;
  startCalls: string[];
  stopCalls: string[];
} {
  const manager = new McpManager();
  const startCalls: string[] = [];
  const stopCalls: string[] = [];
  type ManagerInternals = { clients: Map<string, McpClient>; toolsByServer: Map<string, unknown[]> };
  const internals = manager as unknown as ManagerInternals;
  for (const id of running) {
    const fake: McpClient = {
      serverId: id,
      isRunning: () => true,
      uptimeMs: () => 0,
      start: async () => ({ protocolVersion: "x", capabilities: {} }),
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({ content: [] }),
      stop: async () => {
        stopCalls.push(id);
      },
    };
    internals.clients.set(id, fake);
  }
  // Replace startServer / stopServer with spies that bypass real client
  // construction; we only care about the reconciler's decisions.
  manager.startServer = async (c: McpServerConfig) => {
    startCalls.push(c.id);
    const fake: McpClient = {
      serverId: c.id,
      isRunning: () => true,
      uptimeMs: () => 0,
      start: async () => ({ protocolVersion: "x", capabilities: {} }),
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({ content: [] }),
      stop: async () => {
        stopCalls.push(c.id);
      },
    };
    internals.clients.set(c.id, fake);
  };
  manager.stopServer = async (id: string) => {
    if (internals.clients.delete(id)) stopCalls.push(id);
    internals.toolsByServer?.delete?.(id);
  };
  return { manager, startCalls, stopCalls };
}

describe("mcpLifecycle / reconcileMcpLifecycle", () => {
  it("starts new runnable servers", async () => {
    const { manager, startCalls, stopCalls } = makeManager([]);
    const r = await reconcileMcpLifecycle(manager, [cfg("a"), cfg("b")]);
    expect(r).toEqual({ started: 2, stopped: 0 });
    expect(startCalls.sort()).toEqual(["a", "b"]);
    expect(stopCalls).toEqual([]);
  });

  it("stops servers that disappear from the desired set", async () => {
    const { manager, startCalls, stopCalls } = makeManager(["a", "b"]);
    const r = await reconcileMcpLifecycle(manager, [cfg("a")]);
    expect(r).toEqual({ started: 0, stopped: 1 });
    expect(startCalls).toEqual([]);
    expect(stopCalls).toEqual(["b"]);
  });

  it("treats `enabled: false` as not-runnable (and stops)", async () => {
    const { manager, stopCalls } = makeManager(["a"]);
    const r = await reconcileMcpLifecycle(manager, [cfg("a", { enabled: false })]);
    expect(r).toEqual({ started: 0, stopped: 1 });
    expect(stopCalls).toEqual(["a"]);
  });

  it("treats `autoStart: false` as not-runnable (and stops)", async () => {
    const { manager, stopCalls } = makeManager(["a"]);
    const r = await reconcileMcpLifecycle(manager, [cfg("a", { autoStart: false })]);
    expect(r).toEqual({ started: 0, stopped: 1 });
    expect(stopCalls).toEqual(["a"]);
  });

  it("leaves an already-running runnable server untouched", async () => {
    const { manager, startCalls, stopCalls } = makeManager(["a"]);
    const r = await reconcileMcpLifecycle(manager, [cfg("a")]);
    expect(r).toEqual({ started: 0, stopped: 0 });
    expect(startCalls).toEqual([]);
    expect(stopCalls).toEqual([]);
  });
});

describe("mcpLifecycle / restartMcpServer", () => {
  it("stops then starts a runnable server", async () => {
    const { manager, startCalls, stopCalls } = makeManager(["a"]);
    await restartMcpServer(manager, cfg("a"));
    expect(stopCalls).toEqual(["a"]);
    expect(startCalls).toEqual(["a"]);
  });

  it("does not start a non-runnable server after stopping it", async () => {
    const { manager, startCalls, stopCalls } = makeManager(["a"]);
    await restartMcpServer(manager, cfg("a", { enabled: false }));
    expect(stopCalls).toEqual(["a"]);
    expect(startCalls).toEqual([]);
  });
});

describe("mcpConfigStore / mergeServers + isMcpServerConfig", () => {
  it("project entries override user entries with the same id", () => {
    const user = [cfg("a", { command: "user-cmd" }), cfg("b")];
    const project = [cfg("a", { command: "proj-cmd" }), cfg("c")];
    const merged = mergeServers(user, project);
    expect(merged.map((s) => s.id).sort()).toEqual(["a", "b", "c"]);
    expect(merged.find((s) => s.id === "a")?.command).toBe("proj-cmd");
  });

  it("isMcpServerConfig accepts well-formed configs and rejects junk", () => {
    expect(isMcpServerConfig(cfg("a"))).toBe(true);
    expect(isMcpServerConfig({})).toBe(false);
    expect(isMcpServerConfig({ id: "a", type: "stdio" })).toBe(false);
    expect(isMcpServerConfig({ id: "a", type: "lol", enabled: true })).toBe(false);
    expect(isMcpServerConfig(null)).toBe(false);
    expect(isMcpServerConfig(undefined)).toBe(false);
    expect(isMcpServerConfig("a")).toBe(false);
  });

  it("normalizes project .nexus/mcp.json object format from the spec", () => {
    const list = normalizeMcpServerList({
      servers: {
        github: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          enabled: true,
        },
      },
    });
    expect(list).toEqual([
      {
        id: "github",
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        enabled: true,
      },
    ]);
    expect(list.filter(isMcpServerConfig)).toHaveLength(1);
  });
});
