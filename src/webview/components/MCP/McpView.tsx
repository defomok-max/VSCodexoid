import { useAppStore } from "../../stores/appStore";

export function McpView() {
  const servers = useAppStore((s) => s.state.mcpServers);
  const tools = useAppStore((s) => s.state.mcpTools);
  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-lg font-semibold mb-1">MCP Servers</h2>
        <p className="text-sm text-nexus-muted mb-4">
          Add Model Context Protocol servers (stdio or HTTP/SSE) to expose extra tools to the agent.
          Configure in{" "}
          <code className="px-1 py-0.5 rounded bg-nexus-surface-2 border border-nexus-border">
            .nexus/mcp.json
          </code>
          .
        </p>

        <h3 className="text-sm font-semibold uppercase tracking-wide text-nexus-muted mt-2 mb-2">Servers</h3>
        <div className="space-y-2">
          {servers.length === 0 && (
            <div className="text-sm text-nexus-muted py-4 px-3 nx-card">
              No MCP servers configured. Add an entry to{" "}
              <code className="px-1 py-0.5 rounded bg-nexus-surface-2 border border-nexus-border">.nexus/mcp.json</code>{" "}
              and reload the window.
            </div>
          )}
          {servers.map((s) => (
            <div key={s.id} className="nx-card p-3">
              <div className="flex items-center gap-2">
                <span className="nx-tag">{s.type}</span>
                <span className="font-medium">{s.name ?? s.id}</span>
                <div className="flex-1" />
                <span className="nx-tag">{s.enabled ? "enabled" : "disabled"}</span>
              </div>
              {s.command && (
                <pre className="mt-2 text-[11px] bg-nexus-surface-2 border border-nexus-border rounded p-2 overflow-x-auto">
                  {s.command} {(s.args ?? []).join(" ")}
                </pre>
              )}
            </div>
          ))}
        </div>

        {tools.length > 0 && (
          <>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-nexus-muted mt-6 mb-2">
              Discovered tools <span className="text-nexus-fg/60 normal-case">({tools.length})</span>
            </h3>
            <div className="space-y-1">
              {tools.map((t) => (
                <div key={`${t.serverId}.${t.name}`} className="nx-card p-2 flex items-center gap-2 text-xs">
                  <span className="nx-tag">{t.serverId}</span>
                  <span className="font-mono">{t.name}</span>
                  {t.description && <span className="text-nexus-muted truncate">{t.description}</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
