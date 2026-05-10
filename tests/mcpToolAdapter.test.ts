import { describe, expect, it } from "vitest";
import {
  buildMcpToolDefinition,
  formatMcpResult,
  isMcpToolId,
  mcpToolId,
  mcpToolName,
  type McpCallBridge,
} from "../src/core/mcp/mcpToolAdapter";
import { reconcileMcpTools } from "../src/core/mcp/mcpToolReconciler";
import { ToolRegistry } from "../src/core/tools/toolRegistry";
import type {
  ToolUiBridge,
  ToolSecurityBridge,
  ToolCheckpointBridge,
  ToolFlowBridge,
} from "../src/core/tools/toolTypes";
import type { McpToolCallResult } from "../src/core/mcp/mcpProtocol";
import type { McpToolDescriptor } from "../src/shared/types";

const ui: ToolUiBridge = {
  showInfo: () => {},
  showWarning: () => {},
  showError: () => {},
  getSelection: async () => undefined,
  getOpenFiles: async () => [],
  askUser: async () => undefined,
};
const security: ToolSecurityBridge = {
  isIgnored: () => false,
  resolveWorkspacePath: (p) => p,
  scanSecrets: (s) => ({ redacted: s, matches: [] }),
};
const checkpoints: ToolCheckpointBridge = {
  create: async () => ({ id: "cp", createdAt: 0, files: [] }),
  restore: async () => 0,
  list: () => [],
};
const flow: ToolFlowBridge = {
  setTodo: () => {},
  enqueue: () => ({ id: "q", createdAt: 0 }),
  recordSummary: () => {},
};

function makeCtx() {
  return {
    workspaceRoot: undefined,
    signal: new AbortController().signal,
    log: () => {},
    ui,
    security,
    checkpoints,
    flow,
  };
}

function descriptor(serverId: string, name: string, extras: Partial<McpToolDescriptor> = {}): McpToolDescriptor {
  return {
    serverId,
    name,
    description: `${name} on ${serverId}`,
    inputSchema: { type: "object", properties: { foo: { type: "string" } } },
    riskLevel: "medium",
    enabled: true,
    ...extras,
  };
}

describe("mcpToolAdapter / id helpers", () => {
  it("builds stable, sanitized ids and names", () => {
    expect(mcpToolId("my-server", "read_file")).toBe("mcp:my-server:read_file");
    expect(mcpToolName("my-server", "read_file")).toBe("mcp_my_server_read_file");
    expect(mcpToolName("a:b/c", "x.y-z")).toBe("mcp_a_b_c_x_y_z");
    expect(isMcpToolId("mcp:foo:bar")).toBe(true);
    expect(isMcpToolId("read_file")).toBe(false);
  });
});

describe("mcpToolAdapter / formatMcpResult", () => {
  it("concatenates text blocks with double newlines", () => {
    const r: McpToolCallResult = {
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ],
    };
    expect(formatMcpResult(r)).toBe("hello\n\nworld");
  });

  it("renders non-text blocks as compact markers", () => {
    const r: McpToolCallResult = {
      content: [
        { type: "text", text: "ok" },
        { type: "image", data: "bigbase64", mimeType: "image/png" },
        { type: "resource", resource: { uri: "file:///a.txt" } },
      ],
    };
    expect(formatMcpResult(r)).toBe("ok\n\n[image:image/png]\n\n[resource:file:///a.txt]");
  });

  it("returns a placeholder when content is empty / missing", () => {
    expect(formatMcpResult({ content: [] })).toBe("[mcp: empty result]");
    expect(formatMcpResult({} as McpToolCallResult)).toBe("[mcp: empty result]");
  });
});

describe("mcpToolAdapter / buildMcpToolDefinition", () => {
  it("forwards args to the bridge and shapes the response", async () => {
    let received: { serverId: string; name: string; args: unknown } | undefined;
    const bridge: McpCallBridge = {
      async callTool(serverId, name, args) {
        received = { serverId, name, args };
        return { content: [{ type: "text", text: `you sent ${JSON.stringify(args)}` }] };
      },
    };
    const def = buildMcpToolDefinition(descriptor("srv", "echo"), bridge);
    expect(def.id).toBe("mcp:srv:echo");
    expect(def.name).toBe("mcp_srv_echo");
    expect(def.description).toBe("[mcp:srv] echo on srv");
    expect(def.category).toBe("network");
    expect(def.riskLevel).toBe("medium");
    expect(def.parameters).toEqual({ type: "object", properties: { foo: { type: "string" } } });

    const result = await def.execute({ foo: "bar" }, makeCtx());
    expect(received).toEqual({ serverId: "srv", name: "echo", args: { foo: "bar" } });
    expect(result.content).toBe('you sent {"foo":"bar"}');
    expect(result.error).toBeUndefined();
  });

  it("propagates server-side errors as ToolResult.error", async () => {
    const bridge: McpCallBridge = {
      async callTool() {
        return { content: [{ type: "text", text: "boom" }], isError: true };
      },
    };
    const def = buildMcpToolDefinition(descriptor("srv", "fail"), bridge);
    const result = await def.execute({}, makeCtx());
    expect(result.content).toBe("boom");
    expect(result.error).toBe("MCP server reported error");
  });

  it("catches thrown bridge errors and shapes them as a ToolResult.error", async () => {
    const bridge: McpCallBridge = {
      async callTool() {
        throw new Error("connection refused");
      },
    };
    const def = buildMcpToolDefinition(descriptor("srv", "down"), bridge);
    const result = await def.execute({}, makeCtx());
    expect(result.content).toBe("[mcp:srv:down] error: connection refused");
    expect(result.error).toBe("connection refused");
  });

  it("defaults to medium risk and additive-properties schema when omitted", () => {
    const def = buildMcpToolDefinition(
      { serverId: "srv", name: "minimal", enabled: true } satisfies McpToolDescriptor,
      { callTool: async () => ({ content: [] }) },
    );
    expect(def.riskLevel).toBe("medium");
    expect(def.parameters).toEqual({ type: "object", properties: {}, additionalProperties: true });
    expect(def.description).toBe("[mcp:srv] minimal");
  });
});

describe("mcpToolReconciler", () => {
  const noopBridge: McpCallBridge = { callTool: async () => ({ content: [] }) };

  it("registers all tools on first call", () => {
    const reg = new ToolRegistry();
    const r = reconcileMcpTools(reg, [descriptor("a", "x"), descriptor("a", "y")], noopBridge);
    expect(r).toEqual({ added: 2, removed: 0, kept: 0 });
    expect(reg.idsStartingWith("mcp:").sort()).toEqual(["mcp:a:x", "mcp:a:y"]);
  });

  it("keeps unchanged tools and removes vanished ones", () => {
    const reg = new ToolRegistry();
    reconcileMcpTools(reg, [descriptor("a", "x"), descriptor("a", "y")], noopBridge);
    const r = reconcileMcpTools(reg, [descriptor("a", "x")], noopBridge);
    expect(r).toEqual({ added: 0, removed: 1, kept: 1 });
    expect(reg.idsStartingWith("mcp:")).toEqual(["mcp:a:x"]);
  });

  it("ignores non-mcp tools when removing", () => {
    const reg = new ToolRegistry();
    // Pre-register a built-in tool that should NOT be touched.
    reg.register({
      id: "read_file",
      name: "read_file",
      description: "",
      schema: { parse: (x) => x } as never,
      parameters: { type: "object" },
      riskLevel: "safe",
      category: "read",
      execute: async () => ({ content: "" }),
    });
    reconcileMcpTools(reg, [descriptor("a", "x")], noopBridge);
    reconcileMcpTools(reg, [], noopBridge);
    expect(reg.get("read_file")).toBeDefined();
    expect(reg.idsStartingWith("mcp:")).toEqual([]);
  });

  it("handles a server-id swap by re-registering under the new id", () => {
    const reg = new ToolRegistry();
    reconcileMcpTools(reg, [descriptor("old", "echo")], noopBridge);
    const r = reconcileMcpTools(reg, [descriptor("new", "echo")], noopBridge);
    expect(r).toEqual({ added: 1, removed: 1, kept: 0 });
    expect(reg.idsStartingWith("mcp:")).toEqual(["mcp:new:echo"]);
  });
});
