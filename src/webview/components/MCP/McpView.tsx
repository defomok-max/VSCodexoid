import { useAppStore } from "../../stores/appStore";

export function McpView() {
  const servers = useAppStore((s) => s.state.mcpServers);
  return (
    <div className="h-full overflow-auto px-6 py-5">
      <h2 className="text-lg font-semibold mb-3">MCP Servers</h2>
      <p className="text-sm text-nexus-muted mb-4">
        Add Model Context Protocol servers (stdio or HTTP/SSE) to expose extra tools to the agent.
      </p>
      <div className="space-y-2">
        {servers.length === 0 && (
          <div className="text-sm text-nexus-muted">No MCP servers configured. Edit <code>.nexus/mcp.json</code>.</div>
        )}
        {servers.map((s) => (
          <div key={s.id} className="nx-card p-3">
            <div className="flex items-center gap-2">
              <span className="nx-tag">{s.type}</span>
              <span className="font-medium">{s.name ?? s.id}</span>
              <div className="flex-1" />
              <span className="nx-tag">{s.enabled ? "enabled" : "disabled"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
