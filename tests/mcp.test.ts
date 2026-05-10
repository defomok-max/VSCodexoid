import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpStdioClient } from "../src/core/mcp/mcpClient";
import { McpHttpClient } from "../src/core/mcp/mcpHttpClient";
import { McpManager } from "../src/core/mcp/mcpManager";
import type { McpResponse } from "../src/core/mcp/mcpProtocol";

/**
 * We don't spin up a real MCP server in CI — tests focus on the JSON-RPC
 * framing layer (Content-Length headers, response correlation) and the
 * `isRunning` lifecycle gate.
 */
describe("McpStdioClient (offline)", () => {
  it("reports `isRunning=false` before start", () => {
    const c = new McpStdioClient("test", "echo");
    expect(c.isRunning()).toBe(false);
  });

  it("rejects callTool when not started", async () => {
    const c = new McpStdioClient("test", "echo");
    await expect(c.callTool("foo", {})).rejects.toThrow(/not started/);
  });

  it("stop() is safe when never started", async () => {
    const c = new McpStdioClient("test", "echo");
    await c.stop();
    expect(c.isRunning()).toBe(false);
  });
});

/** Build a `Response` whose body is a single JSON-RPC frame as JSON. */
function jsonResponse(body: McpResponse, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

/** Build a `Response` whose body is a `text/event-stream` of one or more frames. */
function sseResponse(events: { event?: string; data: string }[], headers?: Record<string, string>): Response {
  const body = events
    .map((e) => (e.event ? `event: ${e.event}\n` : "") + `data: ${e.data}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream", ...(headers ?? {}) },
  });
}

describe("McpHttpClient \u2014 streamable HTTP", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("runs initialize handshake and listTools over JSON responses", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = init?.body ? JSON.parse(init.body as string) : null;
      calls.push({ url, init });
      // notifications: 202 empty
      if (body && body.id === undefined) return new Response(null, { status: 202 });
      // initialize
      if (body?.method === "initialize") {
        return jsonResponse(
          {
            jsonrpc: "2.0",
            id: body.id,
            result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "x" } },
          },
          { "mcp-session-id": "session-abc" },
        );
      }
      if (body?.method === "tools/list") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: [{ name: "echo", description: "echoes input" }] },
        });
      }
      throw new Error("unexpected method: " + body?.method);
    }) as unknown as typeof globalThis.fetch;

    const c = new McpHttpClient("srv", { transport: "http", url: "https://server.example/mcp" });
    const init = await c.start(2000);
    expect(init.protocolVersion).toBe("2025-03-26");
    expect(c.isRunning()).toBe(true);

    const tools = await c.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(["echo"]);

    // Session id learned from initialize response must be propagated on later requests.
    const toolsCall = calls.find((c) => JSON.parse(c.init?.body as string).method === "tools/list");
    expect(toolsCall).toBeDefined();
    const headers = new Headers(toolsCall!.init?.headers as HeadersInit);
    expect(headers.get("mcp-session-id")).toBe("session-abc");

    await c.stop();
    expect(c.isRunning()).toBe(false);
  });

  it("reads JSON-RPC reply from text/event-stream POST response", async () => {
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : null;
      if (body && body.id === undefined) return new Response(null, { status: 202 });
      if (body?.method === "initialize") {
        return sseResponse([
          {
            event: "message",
            data: JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: { protocolVersion: "2025-03-26", capabilities: {} },
            }),
          },
        ]);
      }
      throw new Error("unexpected");
    }) as unknown as typeof globalThis.fetch;

    const c = new McpHttpClient("srv", { transport: "http", url: "https://server.example/mcp" });
    const init = await c.start(2000);
    expect(init.protocolVersion).toBe("2025-03-26");
    await c.stop();
  });

  it("surfaces non-2xx responses as errors", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 401, statusText: "Unauthorized" })) as unknown as typeof globalThis.fetch;
    const c = new McpHttpClient("srv", { transport: "http", url: "https://server.example/mcp" });
    await expect(c.start(500)).rejects.toThrow(/401/);
    await c.stop();
  });
});

describe("McpManager \u2014 transport selection", () => {
  it("emits an error status for http config without url", async () => {
    const mgr = new McpManager();
    const events: { id: string; status: string; info?: string }[] = [];
    mgr.setListeners({ status: (id, status, info) => events.push({ id, status, info }) });
    await mgr.startServer({ id: "x", type: "http", enabled: true });
    expect(events.some((e) => e.status === "error" && /missing url/.test(e.info ?? ""))).toBe(true);
  });

  it("emits an error status for sse config without url", async () => {
    const mgr = new McpManager();
    const events: { id: string; status: string; info?: string }[] = [];
    mgr.setListeners({ status: (id, status, info) => events.push({ id, status, info }) });
    await mgr.startServer({ id: "y", type: "sse", enabled: true });
    expect(events.some((e) => e.status === "error" && /missing url/.test(e.info ?? ""))).toBe(true);
  });
});
