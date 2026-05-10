import { useAppStore } from "../../stores/appStore";

export function DiffPanel() {
  const diff = useAppStore((s) => s.state.diff);
  const send = useAppStore((s) => s.send);
  if (!diff || diff.files.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-nexus-muted text-sm">
        No pending changes.
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-nexus-border flex items-center gap-2">
        <h2 className="font-semibold text-sm">Changes ({diff.files.length})</h2>
        <div className="flex-1" />
        <button
          className="nx-btn nx-btn-soft"
          onClick={() => send({ type: "diff/rollback", taskId: diff.taskId })}
        >
          Rollback
        </button>
        <button
          className="nx-btn nx-btn-primary"
          onClick={() => send({ type: "diff/acceptAll", taskId: diff.taskId })}
        >
          Accept all
        </button>
      </div>
      <div className="flex-1 overflow-auto px-4 py-3 space-y-4">
        {diff.files.map((f) => (
          <div key={f.path} className="nx-card overflow-hidden">
            <div className="px-3 py-2 border-b border-nexus-border flex items-center gap-2">
              <span className="nx-tag">{f.status}</span>
              <span className="font-mono text-xs">{f.path}</span>
              <div className="flex-1" />
              <button
                className="nx-btn nx-btn-ghost text-xs"
                onClick={() => send({ type: "diff/rejectFile", taskId: diff.taskId, path: f.path })}
              >
                Reject file
              </button>
              <button
                className="nx-btn nx-btn-soft text-xs"
                onClick={() => send({ type: "diff/acceptFile", taskId: diff.taskId, path: f.path })}
              >
                Accept file
              </button>
            </div>
            <div className="px-3 py-2 text-[12px] font-mono">
              {f.hunks.map((h) => (
                <div key={h.id} className="mb-2">
                  <div className="text-nexus-muted">@@ -{h.startLineBefore} +{h.startLineAfter} @@</div>
                  <pre className="bg-nexus-surface-2 border border-nexus-border rounded-md p-2 whitespace-pre-wrap">
                    <span className="text-[var(--nexus-danger)]">{prefixLines(h.beforeText, "- ")}</span>
                    <span className="text-[var(--nexus-ok)]">{prefixLines(h.afterText, "+ ")}</span>
                  </pre>
                  <div className="mt-1 flex gap-2">
                    <button
                      className="nx-btn nx-btn-ghost text-xs"
                      onClick={() =>
                        send({ type: "diff/rejectHunk", taskId: diff.taskId, path: f.path, hunkId: h.id })
                      }
                    >
                      Reject hunk
                    </button>
                    <button
                      className="nx-btn nx-btn-soft text-xs"
                      onClick={() =>
                        send({ type: "diff/acceptHunk", taskId: diff.taskId, path: f.path, hunkId: h.id })
                      }
                    >
                      Accept hunk
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function prefixLines(text: string, prefix: string): string {
  return text.split("\n").map((l) => prefix + l).join("\n") + "\n";
}
