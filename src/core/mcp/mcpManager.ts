import type { McpServerConfig, McpToolDescriptor } from "../../shared/types";
import { McpStdioClient } from "./mcpClient";
import { McpHttpClient } from "./mcpHttpClient";
import type { McpInitializeResult, McpToolCallResult, McpToolsListResult } from "./mcpProtocol";

/**
 * Common surface implemented by both `McpStdioClient` and `McpHttpClient` so
 * the manager can hold either kind in a single map.
 */
export interface McpClient {
  readonly serverId: string;
  isRunning(): boolean;
  uptimeMs(): number;
  start(timeoutMs?: number): Promise<McpInitializeResult>;
  listTools(): Promise<McpToolsListResult>;
  callTool(name: string, args: unknown, timeoutMs?: number): Promise<McpToolCallResult>;
  stop(): Promise<void>;
}

export interface McpManagerEvents {
  tools: (descriptors: McpToolDescriptor[]) => void;
  status: (serverId: string, status: "starting" | "running" | "stopped" | "error", info?: string) => void;
}

/**
 * Manages the lifecycle of all configured MCP servers and aggregates their
 * tools into a single descriptor list. The agent runner queries this manager
 * for additional tools beyond the built-ins.
 */
export class McpManager {
  private clients = new Map<string, McpClient>();
  private toolsByServer = new Map<string, McpToolDescriptor[]>();
  private listeners: Partial<McpManagerEvents> = {};

  setListeners(l: Partial<McpManagerEvents>): void {
    this.listeners = l;
  }

  async startServer(cfg: McpServerConfig): Promise<void> {
    if (this.clients.has(cfg.id)) await this.stopServer(cfg.id);

    const client = this.createClient(cfg);
    if (!client) return;
    this.clients.set(cfg.id, client);
    this.listeners.status?.(cfg.id, "starting");
    try {
      await client.start();
      this.listeners.status?.(cfg.id, "running");
      const toolsResp = await client.listTools();
      const descriptors: McpToolDescriptor[] = toolsResp.tools.map((t) => ({
        serverId: cfg.id,
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        riskLevel: "medium",
        enabled: true,
      }));
      this.toolsByServer.set(cfg.id, descriptors);
      this.listeners.tools?.(this.aggregateTools());
    } catch (e) {
      this.listeners.status?.(cfg.id, "error", (e as Error).message);
      try {
        await client.stop();
      } catch {
        /* noop */
      }
      this.clients.delete(cfg.id);
    }
  }

  async stopServer(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (!client) return;
    try {
      await client.stop();
    } catch {
      /* noop */
    }
    this.clients.delete(id);
    this.toolsByServer.delete(id);
    this.listeners.status?.(id, "stopped");
    this.listeners.tools?.(this.aggregateTools());
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.clients.keys()].map((id) => this.stopServer(id)));
  }

  aggregateTools(): McpToolDescriptor[] {
    const out: McpToolDescriptor[] = [];
    for (const list of this.toolsByServer.values()) out.push(...list);
    return out;
  }

  getClient(serverId: string): McpClient | undefined {
    return this.clients.get(serverId);
  }

  /** Returns the ids of servers currently held in the client map. */
  runningServerIds(): string[] {
    return [...this.clients.keys()];
  }

  private createClient(cfg: McpServerConfig): McpClient | null {
    if (cfg.type === "stdio") {
      if (!cfg.command) {
        this.listeners.status?.(cfg.id, "error", "stdio server missing command");
        return null;
      }
      return new McpStdioClient(cfg.id, cfg.command, cfg.args ?? [], cfg.env ?? {});
    }
    if (cfg.type === "http" || cfg.type === "sse") {
      if (!cfg.url) {
        this.listeners.status?.(cfg.id, "error", `${cfg.type} server missing url`);
        return null;
      }
      return new McpHttpClient(cfg.id, {
        transport: cfg.type,
        url: cfg.url,
        headers: cfg.headers,
      });
    }
    this.listeners.status?.(cfg.id, "error", `unknown MCP transport "${cfg.type as string}"`);
    return null;
  }
}
