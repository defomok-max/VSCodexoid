import { useAppStore } from "../../stores/appStore";

export function QueuePanel() {
  const queue = useAppStore((s) => s.state.queue);
  const paused = useAppStore((s) => s.state.queuePaused);
  const send = useAppStore((s) => s.send);
  if (queue.length === 0) return null;
  return (
    <div className="border-t border-nexus-border bg-nexus-surface-2 px-3 py-2">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-medium">Queue ({queue.length})</span>
          <span className="nx-tag">{paused ? "paused" : "active"}</span>
          <div className="flex-1" />
          <button
            className="nx-btn nx-btn-ghost text-xs"
            onClick={() => send({ type: paused ? "queue/resume" : "queue/pause" })}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button className="nx-btn nx-btn-ghost text-xs" onClick={() => send({ type: "queue/clear" })}>
            Clear
          </button>
        </div>
        <ul className="space-y-1">
          {queue.map((q, i) => (
            <li key={q.id} className="flex items-center gap-2 text-xs">
              <span className="nx-tag">{i === 0 ? "next" : q.status}</span>
              <span className="truncate flex-1">{q.text}</span>
              <button
                className="nx-btn nx-btn-ghost"
                onClick={() => send({ type: "queue/move", itemId: q.id, direction: "up" })}
              >
                ↑
              </button>
              <button
                className="nx-btn nx-btn-ghost"
                onClick={() => send({ type: "queue/move", itemId: q.id, direction: "down" })}
              >
                ↓
              </button>
              <button
                className="nx-btn nx-btn-ghost"
                onClick={() =>
                  send({ type: "queue/sendNow", itemId: q.id, behavior: "interrupt-current" })
                }
              >
                Send now
              </button>
              <button
                className="nx-btn nx-btn-ghost"
                onClick={() => send({ type: "queue/remove", itemId: q.id })}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
