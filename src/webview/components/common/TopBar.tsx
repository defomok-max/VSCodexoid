import { useAppStore } from "../../stores/appStore";

export function TopBar() {
  const state = useAppStore((s) => s.state);
  const send = useAppStore((s) => s.send);
  const setView = useAppStore((s) => s.setView);

  const currentMode = state.modes.find((m) => m.id === state.currentMode)?.name ?? state.currentMode;
  const currentProvider = state.providers.find((p) => p.id === state.settings.defaultProviderId);

  return (
    <header className="h-12 px-3 flex items-center gap-2 border-b border-nexus-border bg-nexus-surface">
      <button
        onClick={() => setView("chat")}
        className="font-semibold tracking-tight text-sm text-nexus-text mr-2 hover:opacity-80"
      >
        NexusCode
      </button>
      <span className="nx-tag" title="Active mode">
        {currentMode}
      </span>
      <span className="nx-tag" title="Active provider/model">
        {currentProvider?.name ?? "—"} · {state.settings.defaultModelId}
      </span>
      <span className="nx-tag" title="Reasoning effort">
        reasoning: {state.settings.reasoningEffort}
      </span>
      <div className="flex-1" />
      <button
        className="nx-btn nx-btn-soft"
        onClick={() => send({ type: "task/clear" })}
        disabled={!state.currentTask}
      >
        New Task
      </button>
      <button
        className="nx-btn nx-btn-soft"
        onClick={() => send({ type: "task/stop" })}
        disabled={!state.agentBusy}
      >
        Stop
      </button>
      <button className="nx-btn nx-btn-ghost" onClick={() => setView("settings")} aria-label="Settings">
        ⚙︎
      </button>
    </header>
  );
}
