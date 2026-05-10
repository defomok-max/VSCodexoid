import { motion } from "framer-motion";
import type { PlanStep, TodoItem, RiskLevel } from "../../../shared/types";

export function PlanCard({ steps }: { steps: PlanStep[] }) {
  if (!steps || steps.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="nx-card p-3 space-y-2"
    >
      <div className="text-[11px] uppercase tracking-wide text-nexus-muted flex items-center gap-2">
        <span>Plan</span>
        <span className="text-nexus-fg/60">{steps.length} steps</span>
      </div>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-start gap-2 text-sm">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-mono shrink-0 mt-0.5 border border-nexus-border bg-nexus-surface-2">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-medium">{s.title}</div>
              {s.rationale && (
                <div className="text-xs text-nexus-muted leading-relaxed">{s.rationale}</div>
              )}
              <div className="mt-1 flex flex-wrap gap-1">
                {s.toolHint && (
                  <span className="text-[10px] px-1.5 py-[1px] rounded font-mono border border-nexus-border bg-nexus-surface-2">
                    {s.toolHint}
                  </span>
                )}
                {s.expectedFiles?.slice(0, 4).map((f) => (
                  <span
                    key={f}
                    className="text-[10px] px-1.5 py-[1px] rounded font-mono border border-nexus-border bg-nexus-surface-2 truncate max-w-[160px]"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
            {s.riskLevel && <RiskBadge risk={s.riskLevel} />}
          </li>
        ))}
      </ol>
    </motion.div>
  );
}

export function TodoCard({ items }: { items: TodoItem[] }) {
  if (!items || items.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="nx-card p-3 space-y-2"
    >
      <div className="text-[11px] uppercase tracking-wide text-nexus-muted">Todo</div>
      <ul className="space-y-1">
        {items.map((t) => (
          <li key={t.id} className="flex items-start gap-2 text-sm">
            <Checkbox status={t.status} />
            <span className={t.status === "completed" ? "line-through text-nexus-muted" : ""}>{t.text}</span>
            <span className="ml-auto text-[10px] uppercase text-nexus-muted">{t.status}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

function Checkbox({ status }: { status: TodoItem["status"] }) {
  const checked = status === "completed";
  const inProgress = status === "in_progress";
  const blocked = status === "blocked";
  return (
    <span
      className={`inline-flex items-center justify-center w-4 h-4 rounded border mt-0.5 shrink-0 ${
        checked
          ? "bg-emerald-500 border-emerald-500 text-white"
          : inProgress
            ? "bg-amber-500/30 border-amber-500 text-amber-400"
            : blocked
              ? "bg-red-500/20 border-red-500 text-red-400"
              : "border-nexus-border"
      }`}
    >
      {checked ? <span className="text-[10px] leading-none">✓</span> : inProgress ? <span className="text-[10px]">…</span> : blocked ? <span className="text-[10px]">!</span> : null}
    </span>
  );
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
    <span className={`text-[10px] uppercase tracking-wide border rounded px-1 py-[1px] mt-0.5 shrink-0 ${palette[risk]}`}>
      {risk}
    </span>
  );
}
