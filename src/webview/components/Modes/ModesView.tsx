import { motion } from "framer-motion";
import { useAppStore } from "../../stores/appStore";

export function ModesView() {
  const modes = useAppStore((s) => s.state.modes);
  const current = useAppStore((s) => s.state.currentMode);
  const send = useAppStore((s) => s.send);
  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-lg font-semibold mb-1">Modes</h2>
        <p className="text-sm text-nexus-muted mb-4">
          Modes scope the agent's persona, tool allow-list, and approval policy. Click a card to make
          it active for new tasks.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {modes.map((m) => {
            const active = current === m.id;
            return (
              <motion.button
                key={m.id}
                whileTap={{ scale: 0.98 }}
                onClick={() => send({ type: "modes/setActive", modeId: m.id })}
                className={`nx-card p-3 text-left transition-colors ${active ? "ring-2 ring-nexus-accent" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className="nx-tag">{m.id}</span>
                  <span className="font-medium">{m.name}</span>
                  <div className="flex-1" />
                  {active && <span className="text-[10px] uppercase text-nexus-accent">active</span>}
                </div>
                <p className="text-xs text-nexus-muted mt-1 line-clamp-2">{m.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="nx-tag">policy: {m.approvalPolicy}</span>
                  {m.reasoningEffort && <span className="nx-tag">reasoning: {m.reasoningEffort}</span>}
                  {m.riskTolerance && <span className="nx-tag">risk: {m.riskTolerance}</span>}
                </div>
                {m.allowedTools && (
                  <div className="mt-2 text-[11px] text-nexus-muted">
                    {m.allowedTools.length === 0
                      ? "any tool"
                      : `${m.allowedTools.length} tool${m.allowedTools.length === 1 ? "" : "s"} allowed`}
                  </div>
                )}
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
