import { useAppStore } from "../../stores/appStore";

export function ProvidersView() {
  const providers = useAppStore((s) => s.state.providers);
  return (
    <div className="h-full overflow-auto px-6 py-5">
      <h2 className="text-lg font-semibold mb-3">Providers</h2>
      <p className="text-sm text-nexus-muted mb-4">
        Manage provider profiles and API keys. Keys are stored in VS Code SecretStorage and never written to disk.
      </p>
      <div className="space-y-2">
        {providers.length === 0 && (
          <div className="text-sm text-nexus-muted">No providers configured yet.</div>
        )}
        {providers.map((p) => (
          <div key={p.id} className="nx-card p-3">
            <div className="flex items-center gap-2">
              <span className="nx-tag">{p.type}</span>
              <span className="font-medium">{p.name}</span>
              <div className="flex-1" />
              <span className="text-xs text-nexus-muted">{p.defaultModel ?? "—"}</span>
            </div>
            {p.baseUrl && (
              <div className="text-[12px] font-mono text-nexus-muted mt-1">{p.baseUrl}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
