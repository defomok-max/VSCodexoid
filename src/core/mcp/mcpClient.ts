import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type {
  McpInitializeResult,
  McpRequest,
  McpResponse,
  McpToolCallResult,
  McpToolsListResult,
} from "./mcpProtocol";

interface PendingCall {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

/**
 * stdio-based MCP client. Speaks Content-Length-framed JSON-RPC over the
 * server's stdio (the same framing as LSP, which is what the MCP spec
 * mandates for stdio transport).
 */
export class McpStdioClient extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<string | number, PendingCall>();
  private serverInfo?: McpInitializeResult;
  private startedAt = 0;

  constructor(
    public readonly serverId: string,
    public readonly command: string,
    public readonly args: string[] = [],
    public readonly env: Record<string, string> = {},
  ) {
    super();
  }

  isRunning(): boolean {
    return !!this.child && !this.child.killed && this.child.exitCode === null;
  }

  /** Spawns the server and runs the `initialize` handshake. */
  async start(timeoutMs = 10_000): Promise<McpInitializeResult> {
    if (this.isRunning()) return this.serverInfo!;
    this.child = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.startedAt = Date.now();
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onChunk(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => this.emit("stderr", chunk));
    this.child.on("close", (code) => this.onClose(code));
    this.child.on("error", (err) => this.emit("error", err));

    const result = (await this.callWithTimeout("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "NexusCode Agent", version: "0.1.0" },
    }, timeoutMs)) as McpInitializeResult;
    this.serverInfo = result;
    // Notify server initialization is complete.
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return result;
  }

  async listTools(): Promise<McpToolsListResult> {
    return (await this.callWithTimeout("tools/list", {}, 30_000)) as McpToolsListResult;
  }

  async callTool(name: string, args: unknown, timeoutMs = 60_000): Promise<McpToolCallResult> {
    return (await this.callWithTimeout(
      "tools/call",
      { name, arguments: args },
      timeoutMs,
    )) as McpToolCallResult;
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    try {
      this.child.kill("SIGTERM");
    } catch {
      /* noop */
    }
    this.child = undefined;
    for (const [, p] of this.pending) p.reject(new Error("client stopped"));
    this.pending.clear();
  }

  uptimeMs(): number {
    return this.startedAt === 0 ? 0 : Date.now() - this.startedAt;
  }

  private async callWithTimeout(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (!this.child) throw new Error("MCP client not started");
    const id = this.nextId++;
    const req: McpRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise<unknown>((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      this.send(req);
    });
  }

  private send(msg: McpRequest | { jsonrpc: "2.0"; method: string; params?: unknown }): void {
    if (!this.child) throw new Error("MCP client not started");
    const payload = JSON.stringify(msg);
    const frame = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`;
    this.child.stdin.write(frame);
  }

  private onChunk(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd);
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!lengthMatch) {
        // garbage; drop and continue
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const len = parseInt(lengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + len) return; // wait for more
      const body = this.buffer.slice(bodyStart, bodyStart + len);
      this.buffer = this.buffer.slice(bodyStart + len);
      try {
        const msg = JSON.parse(body) as McpResponse;
        this.dispatch(msg);
      } catch (e) {
        this.emit("error", new Error(`bad MCP frame: ${(e as Error).message}`));
      }
    }
  }

  private dispatch(msg: McpResponse): void {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else {
      this.emit("notification", msg);
    }
  }

  private onClose(code: number | null): void {
    this.emit("close", code);
    for (const [, p] of this.pending) p.reject(new Error(`MCP server exited (code ${code ?? "?"})`));
    this.pending.clear();
    this.child = undefined;
  }
}
