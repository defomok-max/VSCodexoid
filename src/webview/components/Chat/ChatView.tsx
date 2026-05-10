import { useState } from "react";
import { useAppStore } from "../../stores/appStore";
import { QueuePanel } from "../Queue/QueuePanel";

export function ChatView() {
  const state = useAppStore((s) => s.state);
  const send = useAppStore((s) => s.send);
  const [text, setText] = useState("");
  const messages = state.currentTask?.messages ?? [];

  const onSend = (sendNow = false) => {
    if (!text.trim()) return;
    if (state.agentBusy && !sendNow) {
      send({
        type: "queue/add",
        item: { text, priority: 0 },
      });
    } else {
      send({
        type: "task/start",
        prompt: text,
        modeId: state.currentMode,
        providerId: state.settings.defaultProviderId,
        modelId: state.settings.defaultModelId,
        sendBehavior: sendNow ? "interrupt-current" : "append-followup",
      });
    }
    setText("");
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-auto">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            {messages.map((m) => (
              <div key={m.id} className={`animate-slideUp ${m.role === "user" ? "" : ""}`}>
                <div className="text-[11px] uppercase tracking-wide text-nexus-muted mb-1">
                  {m.role}
                </div>
                <div className="nx-card p-3 markdown whitespace-pre-wrap">{m.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <QueuePanel />
      <div className="border-t border-nexus-border bg-nexus-surface px-3 py-3">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <textarea
            className="nx-input min-h-[64px] resize-y"
            placeholder={
              state.agentBusy
                ? "Agent is working — your message will be queued. Press Send Now to interrupt."
                : "Ask Nexus to understand, change, test, or review your code…"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSend(false);
              }
            }}
          />
          <div className="flex flex-col gap-2">
            <button className="nx-btn nx-btn-primary" onClick={() => onSend(false)}>
              {state.agentBusy ? "Queue" : "Send"}
            </button>
            {state.agentBusy && (
              <button className="nx-btn nx-btn-soft" onClick={() => onSend(true)}>
                Send Now
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  const send = useAppStore((s) => s.send);
  const quick: { label: string; prompt: string }[] = [
    { label: "Explain current file", prompt: "Explain the currently active file." },
    { label: "Fix problems", prompt: "Look at the current file's diagnostics and propose fixes." },
    { label: "Review git diff", prompt: "Review the current git diff for bugs and risks." },
    { label: "Generate tests", prompt: "Generate tests for the currently selected code." },
    { label: "Refactor selection", prompt: "Refactor the selection for clarity without changing behavior." },
  ];
  return (
    <div className="h-full flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-4 animate-fadeIn">
        <div className="text-4xl">◆</div>
        <h2 className="text-lg font-semibold">Ask Nexus to understand, change, test, or review your code.</h2>
        <p className="text-sm text-nexus-muted">
          Pick a quick action or type your task. The agent will plan, ask for approval, then execute.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {quick.map((q) => (
            <button
              key={q.label}
              className="nx-btn nx-btn-soft"
              onClick={() =>
                send({ type: "task/start", prompt: q.prompt })
              }
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
