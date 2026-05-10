import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAppStore } from "../../stores/appStore";
import { QueuePanel } from "../Queue/QueuePanel";
import { Markdown } from "./Markdown";
import { ToolCallCard } from "./ToolCallCard";
import { PlanCard, TodoCard } from "./PlanCard";

export function ChatView() {
  const state = useAppStore((s) => s.state);
  const send = useAppStore((s) => s.send);
  const [text, setText] = useState("");
  const messages = state.currentTask?.messages ?? [];
  const toolCalls = state.currentTask?.toolCalls ?? [];
  const plan = state.currentTask?.plan ?? [];
  const todo = state.currentTask?.todo ?? [];
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, state.currentTask?.id]);

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
      <div ref={scrollerRef} className="flex-1 overflow-auto">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            {plan.length > 0 && <PlanCard steps={plan} />}
            {todo.length > 0 && <TodoCard items={todo} />}
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <div className="text-[11px] uppercase tracking-wide text-nexus-muted mb-1 flex items-center gap-2">
                    <span>{m.role}</span>
                    {m.reasoningSummary && <span className="text-amber-400/80">↳ thinking</span>}
                  </div>
                  <div className="nx-card p-3">
                    {m.role === "tool" ? (
                      <pre className="text-xs whitespace-pre-wrap break-words">{m.content}</pre>
                    ) : (
                      <Markdown content={m.content || ""} />
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {toolCalls.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] uppercase tracking-wide text-nexus-muted">Tool calls</div>
                <AnimatePresence initial={false}>
                  {toolCalls.map((tc) => (
                    <ToolCallCard key={tc.id} call={tc} />
                  ))}
                </AnimatePresence>
              </div>
            )}
            {state.agentBusy && <Thinking />}
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
              <>
                <button className="nx-btn nx-btn-soft" onClick={() => onSend(true)}>
                  Send Now
                </button>
                <button
                  className="nx-btn nx-btn-soft text-red-400"
                  onClick={() => send({ type: "task/stop" })}
                >
                  Stop
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Thinking() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-xs text-nexus-muted flex items-center gap-2"
    >
      <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
      <span>Agent is working…</span>
    </motion.div>
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
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md text-center space-y-4"
      >
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
      </motion.div>
    </div>
  );
}
