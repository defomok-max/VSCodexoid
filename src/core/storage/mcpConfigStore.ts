import * as vscode from "vscode";
import type { McpServerConfig } from "../../shared/types";

const KEY = "nexus.mcpServers";
const PROJECT_FILE_REL = ".nexus/mcp.json";

/**
 * Persists the user's list of MCP server configurations and exposes a
 * read-only project-level override at `.nexus/mcp.json`.
 *
 * Storage layout:
 *   - **User scope** \u2014 `globalState["nexus.mcpServers"]`. Authoritative,
 *     editable from the UI via `mcp/save` messages.
 *   - **Project scope** \u2014 `<workspace>/.nexus/mcp.json` (optional). Loaded
 *     read-only on activation; entries override user-scope entries with the
 *     same `id`.
 *
 * The merge rule (`mergeServers`) is "project-replaces-user-by-id"; servers
 * unique to either scope are kept. Per the project docs, `.nexus/mcp.json`
 * is meant to ship inside the repo so a team can prescribe the agent's MCP
 * surface; we therefore never write to it from the host.
 */
export class McpConfigStore {
  constructor(
    private readonly memento: vscode.Memento,
    private readonly workspaceRoot: string | undefined,
  ) {}

  /** Returns the merged list of servers (user + optional project file). */
  async read(): Promise<McpServerConfig[]> {
    const user = this.memento.get<McpServerConfig[]>(KEY, []);
    const project = await this.readProjectFile();
    return mergeServers(Array.isArray(user) ? user : [], project);
  }

  /** Writes ONLY user-scope entries (never touches the project file). */
  async write(servers: McpServerConfig[]): Promise<void> {
    await this.memento.update(KEY, servers);
  }

  async clear(): Promise<void> {
    await this.memento.update(KEY, []);
  }

  private async readProjectFile(): Promise<McpServerConfig[]> {
    if (!this.workspaceRoot) return [];
    try {
      const uri = vscode.Uri.joinPath(vscode.Uri.file(this.workspaceRoot), PROJECT_FILE_REL);
      const bytes = await vscode.workspace.fs.readFile(uri);
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      const list = normalizeMcpServerList(parsed);
      return list.filter(isMcpServerConfig);
    } catch {
      // Missing file (most common) and parse errors both fall back to no
      // project override. We swallow silently here \u2014 the host can decide
      // whether to surface this in the UI.
      return [];
    }
  }
}

export function normalizeMcpServerList(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  const servers = (parsed as { servers?: unknown }).servers;
  if (Array.isArray(servers)) return servers;
  if (!servers || typeof servers !== "object") return [];
  return Object.entries(servers).map(([id, cfg]) => ({
    id,
    ...(cfg && typeof cfg === "object" ? cfg : {}),
  }));
}

/**
 * Merges user-scope and project-scope server lists. Project entries override
 * user entries with the same `id`; entries unique to either scope survive.
 */
export function mergeServers(
  user: ReadonlyArray<McpServerConfig>,
  project: ReadonlyArray<McpServerConfig>,
): McpServerConfig[] {
  const byId = new Map<string, McpServerConfig>();
  for (const s of user) byId.set(s.id, s);
  for (const s of project) byId.set(s.id, s);
  return [...byId.values()];
}

/**
 * Narrow-typing guard. We accept anything that has at least an `id`, a
 * `type` we know about, and an `enabled` boolean. Everything else is
 * defaulted by the caller.
 */
export function isMcpServerConfig(v: unknown): v is McpServerConfig {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return false;
  if (o.type !== "stdio" && o.type !== "http" && o.type !== "sse") return false;
  if (typeof o.enabled !== "boolean") return false;
  return true;
}
