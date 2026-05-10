import { useEffect } from "react";
import { useAppStore } from "./stores/appStore";
import { Sidebar } from "./components/common/Sidebar";
import { ChatView } from "./components/Chat/ChatView";
import { SettingsView } from "./components/Settings/SettingsView";
import { ProvidersView } from "./components/Providers/ProvidersView";
import { McpView } from "./components/MCP/McpView";
import { SkillsView } from "./components/Skills/SkillsView";
import { ModesView } from "./components/Modes/ModesView";
import { TasksView } from "./components/Tasks/TasksView";
import { UsageView } from "./components/Usage/UsageView";
import { ApprovalDialog } from "./components/common/ApprovalDialog";
import { DiffPanel } from "./components/Diff/DiffPanel";
import { TopBar } from "./components/common/TopBar";

export function App() {
  const view = useAppStore((s) => s.activeView);
  const initialize = useAppStore((s) => s.initialize);
  const theme = useAppStore((s) => s.state.settings.ui.theme);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    const root = document.documentElement;
    const apply = (t: "light" | "dark") => {
      root.classList.toggle("dark", t === "dark");
    };
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mq.matches ? "dark" : "light");
      const handler = () => apply(mq.matches ? "dark" : "light");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    apply(theme);
    return undefined;
  }, [theme]);

  return (
    <div className="h-full flex flex-col bg-nexus-bg text-nexus-text">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-hidden">
          {view === "chat" && <ChatView />}
          {view === "tasks" && <TasksView />}
          {view === "usage" && <UsageView />}
          {view === "diff" && <DiffPanel />}
          {view === "settings" && <SettingsView />}
          {view === "providers" && <ProvidersView />}
          {view === "mcp" && <McpView />}
          {view === "skills" && <SkillsView />}
          {view === "modes" && <ModesView />}
        </main>
      </div>
      <ApprovalDialog />
    </div>
  );
}
