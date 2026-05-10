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

export interface McpHttpClientOptions {
  /**
   * Transport flavour:
   * - `"http"` is the **Streamable HTTP** transport from MCP spec 2025-03-26:
   *   one endpoint, every client request is a POST whose response can be JSON
   *   or `text/event-stream` (SSE) carrying the JSON-RPC reply plus optional
   *   server-initiated notifications.
   * - `"sse"` is the legacy **HTTP+SSE** transport from MCP spec 2024-11-05:
   *   client opens a long-lived GET to receive `event: endpoint` (the message
   *   POST URL) and subsequent `event: message` JSON-RPC frames; client sends
   *   requests via POST to the announced endpoint.
   */
  transport: "http" | "sse";
  /**
   * Base URL for the server. For `transport="http"` this is the single
   * Streamable HTTP endpoint. For `transport="sse"` this is the GET URL that
   * yields the SSE stream — the actual POST endpoint is announced via the
   * `event: endpoint` SSE event.
   */
  url: string;
  headers?: Record<string, string>;
}

/**
 * HTTP-based MCP client. Implements the same surface as `McpStdioClient` so
 * `McpManager` can treat them interchangeably.
 *
 * Spec references:
 * - Streamable HTTP (current): https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http
 * - Legacy HTTP+SSE: https://modelcontextprotocol.io/specification/2024-11-05/basic/transports#http-with-sse
 */
export class McpHttpClient extends EventEmitter {
  private nextId = 1;
  private pending = new Map<string | number, PendingCall>();
  private serverInfo?: McpInitializeResult;
  private startedAt = 0;
  private running = false;
  private sessionId?: string;
  private sseAbort?: AbortController;
  /** SSE-only: announced POST endpoint after the `event: endpoint` event. */
  private ssePostUrl?: string;
  private ssePostUrlReady?: Promise<void>;
  private resolveSsePostUrl?: () => void;

  constructor(public readonly serverId: string, private readonly opts: McpHttpClientOptions) {
    super();
  }

  isRunning(): boolean {
    return this.running;
  }

  uptimeMs(): number {
    return this.startedAt === 0 ? 0 : Date.now() - this.startedAt;
  }

  async start(timeoutMs = 10_000): Promise<McpInitializeResult> {
    if (this.running) return this.serverInfo!;
    this.startedAt = Date.now();
    this.running = true;

    if (this.opts.transport === "sse") {
      // For HTTP+SSE we must open the SSE stream first so the server can tell
      // us which URL to POST messages to.
      this.ssePostUrlReady = new Promise<void>((resolve) => {
        this.resolveSsePostUrl = resolve;
      });
      void this.openSseStream(this.opts.url);
      // Wait briefly for the endpoint announcement before we send initialize.
      await Promise.race([
        this.ssePostUrlReady,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("SSE endpoint announcement timed out")), timeoutMs),
        ),
      ]);
    }

    const result = (await this.callWithTimeout(
      "initialize",
      {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "NexusCode Agent", version: "0.1.0" },
      },
      timeoutMs,
    )) as McpInitializeResult;
    this.serverInfo = result;

    // Streamable HTTP: any session id the server returned now becomes mandatory.
    // Notify initialized (notification, no id, no response expected).
    await this.sendNotification("notifications/initialized");
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
    if (!this.running) return;
    this.running = false;
    this.sseAbort?.abort();
    this.sseAbort = undefined;
    for (const [, p] of this.pending) p.reject(new Error("client stopped"));
    this.pending.clear();
    this.emit("close", null);
  }

  private async callWithTimeout(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (!this.running) throw new Error("MCP client not started");
    const id = this.nextId++;
    const req: McpRequest = { jsonrpc: "2.0", id, method, params };

    let timer: NodeJS.Timeout | undefined;
    const settled = new Promise<unknown>((resolve, reject) => {
      timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          if (timer) clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          if (timer) clearTimeout(timer);
          reject(e);
        },
      });
    });
    // Swallow the rejection if nothing awaits `settled` because `sendRequest`
    // already threw — we still want callWithTimeout to surface that error.
    settled.catch(() => undefined);

    try {
      await this.sendRequest(req);
    } catch (e) {
      if (timer) clearTimeout(timer);
      this.pending.delete(id);
      throw e;
    }
    return settled;
  }

  private async sendNotification(method: string, params?: unknown): Promise<void> {
    const note = { jsonrpc: "2.0" as const, method, params };
    await this.sendRequest(note);
  }

  /** POST a JSON-RPC frame; for streamable HTTP also handles the response. */
  private async sendRequest(msg: McpRequest | { jsonrpc: "2.0"; method: string; params?: unknown }): Promise<void> {
    const target = this.opts.transport === "sse" ? this.ssePostUrl ?? this.opts.url : this.opts.url;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(this.opts.headers ?? {}),
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

    const res = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify(msg),
    });

    // Streamable HTTP: the server can choose to keep returning notifications
    // for this request via SSE in the response body. We need to read that.
    const sessionFromServer = res.headers.get("mcp-session-id");
    if (sessionFromServer) this.sessionId = sessionFromServer;

    // Notifications get HTTP 202 with empty body — nothing to parse.
    if ("id" in msg === false || msg.id === undefined) {
      // best-effort drain so we don't leak the body
      await res.body?.cancel().catch(() => undefined);
      if (!res.ok) throw new Error(`MCP HTTP ${res.status} ${res.statusText}`);
      return;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`MCP HTTP ${res.status} ${res.statusText}${text ? ": " + text.slice(0, 200) : ""}`);
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("text/event-stream")) {
      // Stream replies inline; dispatch as they arrive.
      void this.consumeSse(res);
    } else {
      const json = (await res.json().catch(() => null)) as McpResponse | McpResponse[] | null;
      if (json) {
        for (const item of Array.isArray(json) ? json : [json]) this.dispatch(item);
      }
    }
  }

  /** Open the long-lived SSE stream for the legacy HTTP+SSE transport. */
  private async openSseStream(url: string): Promise<void> {
    const ac = new AbortController();
    this.sseAbort = ac;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { accept: "text/event-stream", ...(this.opts.headers ?? {}) },
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`SSE GET ${res.status} ${res.statusText}`);
      await this.parseSseStream(res.body, /*viaGetStream*/ true);
    } catch (e) {
      if (!(e instanceof Error) || e.name !== "AbortError") {
        this.emit("error", e instanceof Error ? e : new Error(String(e)));
        await this.stop();
      }
    }
  }

  /** Drain the response body of a streamable-HTTP POST as SSE. */
  private async consumeSse(res: Response): Promise<void> {
    if (!res.body) return;
    try {
      await this.parseSseStream(res.body, /*viaGetStream*/ false);
    } catch (e) {
      this.emit("error", e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async parseSseStream(body: ReadableStream<Uint8Array>, viaGetStream: boolean): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      // SSE events are terminated by a blank line (\n\n or \r\n\r\n).
      let sep: number;
      while ((sep = findEventBoundary(buf)) !== -1) {
        const raw = buf.slice(0, sep);
        // skip the blank line at the boundary
        const advance = buf.startsWith("\r\n\r\n", sep) || buf.startsWith("\n\n", sep) ? sep + (buf.startsWith("\r\n\r\n", sep) ? 4 : 2) : sep;
        buf = buf.slice(advance);
        this.handleSseEvent(raw, viaGetStream);
      }
    }
  }

  private handleSseEvent(raw: string, viaGetStream: boolean): void {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line) continue;
      if (line.startsWith(":")) continue; // comment
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^\s/, "");
      if (field === "event") event = value;
      else if (field === "data") dataLines.push(value);
    }
    const data = dataLines.join("\n");
    if (!data) return;

    if (viaGetStream && event === "endpoint") {
      // Legacy HTTP+SSE: server announces the POST URL.
      try {
        // Spec allows the announcement either as a bare URL string or a JSON
        // object like `{"endpoint": "/messages?session=…"}`. We accept both.
        const trimmed = data.trim();
        if (trimmed.startsWith("{")) {
          const parsed = JSON.parse(trimmed) as { endpoint?: string };
          if (parsed.endpoint) this.ssePostUrl = resolveAgainst(this.opts.url, parsed.endpoint);
        } else {
          this.ssePostUrl = resolveAgainst(this.opts.url, trimmed);
        }
      } catch {
        this.ssePostUrl = resolveAgainst(this.opts.url, data.trim());
      }
      this.resolveSsePostUrl?.();
      return;
    }

    if (event === "message" || event === "") {
      try {
        const parsed = JSON.parse(data) as McpResponse;
        this.dispatch(parsed);
      } catch (e) {
        this.emit("error", new Error(`bad MCP SSE frame: ${(e as Error).message}`));
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
}

function findEventBoundary(buf: string): number {
  const a = buf.indexOf("\n\n");
  const b = buf.indexOf("\r\n\r\n");
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function resolveAgainst(base: string, ref: string): string {
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
}
