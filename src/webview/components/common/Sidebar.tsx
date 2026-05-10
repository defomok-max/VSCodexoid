import type { ViewId } from "../../stores/appStore";
import { useAppStore } from "../../stores/appStore";

const items: { id: ViewId; label: string; icon: string }[] = [
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "tasks", label: "Tasks", icon: "🗂" },
  { id: "usage", label: "Usage", icon: "Σ" },
  { id: "diff", label: "Diff", icon: "±" },
  { id: "providers", label: "Providers", icon: "⚡" },
  { id: "modes", label: "Modes", icon: "◐" },
  { id: "skills", label: "Skills", icon: "★" },
  { id: "mcp", label: "MCP", icon: "⌬" },
  { id: "settings", label: "Settings", icon: "⚙︎" },
];

export function Sidebar() {
  const active = useAppStore((s) => s.activeView);
  const setView = useAppStore((s) => s.setView);
  return (
    <aside className="w-12 shrink-0 border-r border-nexus-border bg-nexus-surface flex flex-col items-center gap-1 py-2">
      {items.map((it) => {
        const isActive = active === it.id;
        return (
          <button
            key={it.id}
            title={it.label}
            onClick={() => setView(it.id)}
            className={`w-9 h-9 rounded-xl flex items-center justify-center text-base transition-colors ${
              isActive ? "bg-nexus-surface-2 text-nexus-text" : "text-nexus-muted hover:text-nexus-text"
            }`}
            aria-current={isActive ? "page" : undefined}
          >
            <span aria-hidden>{it.icon}</span>
          </button>
        );
      })}
    </aside>
  );
}
