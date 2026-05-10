import { useAppStore } from "../../stores/appStore";

export function ModesView() {
  const modes = useAppStore((s) => s.state.modes);
  const current = useAppStore((s) => s.state.currentMode);
  const send = useAppStore((s) => s.send);
  return (
    <div className="h-full overflow-auto px-6 py-5">
      <h2 className="text-lg font-semibold mb-3">Modes</h2>
      <div className="space-y-2">
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => send({ type: "modes/setActive", modeId: m.id })}
            className={`nx-card p-3 w-full text-left ${current === m.id ? "ring-2 ring-nexus-accent" : ""}`}
          >
            <div className="flex items-center gap-2">
              <span className="nx-tag">{m.id}</span>
              <span className="font-medium">{m.name}</span>
              <div className="flex-1" />
              <span className="nx-tag">{m.approvalPolicy}</span>
            </div>
            <p className="text-xs text-nexus-muted mt-1">{m.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
