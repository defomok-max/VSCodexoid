import { useAppStore } from "../../stores/appStore";

export function TasksView() {
  const recent = useAppStore((s) => s.state.recentTasks);
  return (
    <div className="h-full overflow-auto px-6 py-5">
      <h2 className="text-lg font-semibold mb-3">Tasks</h2>
      <div className="space-y-2">
        {recent.length === 0 && (
          <div className="text-sm text-nexus-muted">No tasks yet. Start one from the Chat tab.</div>
        )}
        {recent.map((t) => (
          <div key={t.id} className="nx-card p-3">
            <div className="flex items-center gap-2">
              <span className="nx-tag">{t.status}</span>
              <span className="font-medium">{t.title}</span>
              <div className="flex-1" />
              <span className="text-xs text-nexus-muted">
                {new Date(t.startedAt).toLocaleString()}
              </span>
            </div>
            {t.finalSummary && <p className="text-xs text-nexus-muted mt-1">{t.finalSummary}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
