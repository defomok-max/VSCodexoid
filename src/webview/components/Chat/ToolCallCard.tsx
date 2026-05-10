import { useState } from "react";
import { motion } from "framer-motion";
import type { RiskLevel, ToolCallRecord } from "../../../shared/types";

interface Props {
  call: ToolCallRecord;
}

/**
 * Renders a tool-call activity card with a risk badge, expandable args/results
 * preview, and pass/fail icon. Mirrors how Claude / Devin / Cline surface
 * each tool invocation in chat.
 */
export function ToolCallCard({ call }: Props) {
  const [open, setOpen] = useState(false);
  const status = call.endedAt
    ? call.ok === false
      ? "failed"
      : "ok"
    : "running";
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="nx-card text-xs border-l-2"
      style={{ borderLeftColor: borderForStatus(status) }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={status} />
          <span className="font-mono truncate">{call.name || "<tool>"}</span>
          {call.riskLevel && <RiskBadge risk={call.riskLevel} />}
          {call.approvalState && (
            <span className="text-[10px] uppercase text-nexus-muted">{call.approvalState}</span>
          )}
        </div>
        <span className="text-nexus-muted ml-2 shrink-0">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {call.args !== undefined && (
            <Section label="args">
              <pre className="text-[11px] whitespace-pre-wrap break-all">{JSON.stringify(call.args, null, 2)}</pre>
            </Section>
          )}
          {call.resultPreview && (
            <Section label="result">
              <pre className="text-[11px] whitespace-pre-wrap break-all">{call.resultPreview}</pre>
            </Section>
          )}
          {call.errorMessage && (
            <Section label="error">
              <pre className="text-[11px] whitespace-pre-wrap break-all text-red-500">{call.errorMessage}</pre>
            </Section>
          )}
        </div>
      )}
    </motion.div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-nexus-muted mb-1">{label}</div>
      <div className="rounded border border-nexus-border bg-nexus-surface-2 p-2">{children}</div>
    </div>
  );
}

function StatusDot({ status }: { status: "running" | "ok" | "failed" }) {
  const colour =
    status === "running" ? "bg-amber-400 animate-pulse" : status === "ok" ? "bg-emerald-500" : "bg-red-500";
  return <span className={`inline-block w-2 h-2 rounded-full ${colour}`} />;
}

function RiskBadge({ risk }: { risk: RiskLevel }) {
  const palette: Record<RiskLevel, string> = {
    safe: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    low: "bg-sky-500/10 text-sky-400 border-sky-500/30",
    medium: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
    critical: "bg-red-500/10 text-red-400 border-red-500/30",
  };
  return (
    <span className={`text-[10px] uppercase tracking-wide border rounded px-1 py-[1px] ${palette[risk]}`}>
      {risk}
    </span>
  );
}

function borderForStatus(status: "running" | "ok" | "failed"): string {
  if (status === "running") return "rgb(245, 158, 11)";
  if (status === "ok") return "rgb(16, 185, 129)";
  return "rgb(239, 68, 68)";
}
