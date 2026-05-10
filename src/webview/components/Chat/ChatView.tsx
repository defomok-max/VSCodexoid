import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAppStore } from "../../stores/appStore";
import { QueuePanel } from "../Queue/QueuePanel";
import { Markdown } from "./Markdown";
import { ToolCallCard } from "./ToolCallCard";
import { PlanCard, TodoCard } from "./PlanCard";
import {
  fileToImageAttachment,
  imagesFromClipboard,
  imagesFromDrop,
} from "./attachments";
import type { AttachmentRef } from "../../../shared/types";

export function ChatView() {
  const state = useAppStore((s) => s.state);
  const send = useAppStore((s) => s.send);
  const pushToast = useAppStore((s) => s.pushToast);
  const [text, setText] = useState("");
  const [pendingImages, setPendingImages] = useState<AttachmentRef[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
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

  const ingestFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const accepted: AttachmentRef[] = [];
    let rejected = 0;
    for (const f of files) {
      const att = await fileToImageAttachment(f);
      if (att) accepted.push(att);
      else rejected += 1;
    }
    if (accepted.length > 0) {
      setPendingImages((prev) => [...prev, ...accepted]);
    }
    if (rejected > 0) {
      pushToast("warn", `Skipped ${rejected} attachment${rejected === 1 ? "" : "s"} (must be an image ≤5 MB).`);
    }
  };

  const removeImage = (idx: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const onSend = (sendNow = false) => {
    if (!text.trim() && pendingImages.length === 0) return;
    const attachments = pendingImages.length > 0 ? pendingImages : undefined;
    if (state.agentBusy && !sendNow) {
      send({
        type: "queue/add",
        item: { text, priority: 0, attachments },
      });
    } else {
      send({
        type: "task/start",
        prompt: text,
        modeId: state.currentMode,
        providerId: state.settings.defaultProviderId,
        modelId: state.settings.defaultModelId,
        sendBehavior: sendNow ? "interrupt-current" : "append-followup",
        attachments,
      });
    }
    setText("");
    setPendingImages([]);
  };

  return (
    <div
      className={`h-full flex flex-col ${isDragOver ? "ring-2 ring-nexus-accent ring-inset" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
          e.preventDefault();
          setIsDragOver(true);
        }
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        const files = imagesFromDrop(e.nativeEvent);
        if (files.length > 0) {
          e.preventDefault();
          setIsDragOver(false);
          void ingestFiles(files);
        }
      }}
    >
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
                      <>
                        {m.attachments && m.attachments.some((a) => a.kind === "image") && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {m.attachments
                              .filter((a) => a.kind === "image")
                              .map((a, i) => (
                                <img
                                  key={i}
                                  src={`data:${a.mimeType ?? "image/png"};base64,${a.dataBase64}`}
                                  alt={a.name ?? `attachment ${i + 1}`}
                                  className="max-h-48 rounded-lg border border-nexus-border"
                                />
                              ))}
                          </div>
                        )}
                        <Markdown content={m.content || ""} />
                      </>
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
          <div className="flex-1 flex flex-col gap-2">
            {pendingImages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {pendingImages.map((att, idx) => (
                  <div key={idx} className="relative">
                    <img
                      src={`data:${att.mimeType ?? "image/png"};base64,${att.dataBase64}`}
                      alt={att.name ?? `image ${idx + 1}`}
                      className="h-16 w-16 object-cover rounded-lg border border-nexus-border"
                    />
                    <button
                      onClick={() => removeImage(idx)}
                      title="Remove image"
                      className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-nexus-surface-2 text-nexus-text text-xs leading-none flex items-center justify-center hover:bg-red-500/80"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              className="nx-input min-h-[64px] resize-y"
              placeholder={
                state.agentBusy
                  ? "Agent is working — your message will be queued. Press Send Now to interrupt."
                  : "Ask Nexus to understand, change, test, or review your code (paste or drop images for vision models)…"
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const files = imagesFromClipboard(e.nativeEvent);
                if (files.length > 0) {
                  e.preventDefault();
                  void ingestFiles(files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onSend(false);
                }
              }}
            />
          </div>
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
