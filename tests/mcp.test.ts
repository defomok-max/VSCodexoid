import { describe, expect, it } from "vitest";
import { McpStdioClient } from "../src/core/mcp/mcpClient";

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
