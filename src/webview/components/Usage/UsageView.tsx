import { useMemo } from "react";
import { useAppStore } from "../../stores/appStore";
import {
  aggregateUsage,
  formatTokens,
  formatUsd,
  type UsageBucket,
} from "./usageMath";

export function UsageView() {
  const recent = useAppStore((s) => s.state.recentTasks);
  const providers = useAppStore((s) => s.state.providers);

  const { totals, byProvider, byModel, taskCosts } = useMemo(
    () => aggregateUsage(recent, providers),
    [recent, providers],
  );

  return (
    <div className="h-full overflow-auto px-6 py-5">
      <h2 className="text-lg font-semibold mb-1">Usage</h2>
      <p className="text-xs text-nexus-muted mb-4">
        Aggregated across the {totals.taskCount} most recent task
        {totals.taskCount === 1 ? "" : "s"} kept in session history.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-5 lg:grid-cols-4">
        <Stat label="Total cost" value={formatUsd(totals.totalCostUsd)} hint={
          totals.pricedTaskCount === totals.taskCount
            ? `${totals.taskCount} task${totals.taskCount === 1 ? "" : "s"}`
            : `${totals.pricedTaskCount}/${totals.taskCount} priced`
        } />
        <Stat label="Input tokens" value={formatTokens(totals.inputTokens)} />
        <Stat label="Output tokens" value={formatTokens(totals.outputTokens)} />
        <Stat
          label="Avg / task"
          value={
            totals.taskCount === 0
              ? "—"
              : formatUsd(totals.totalCostUsd / Math.max(1, totals.pricedTaskCount))
          }
          hint="of priced tasks"
        />
      </div>

      <Section title="By provider" buckets={byProvider} emptyText="No tasks yet — start a chat." />
      <Section title="By model" buckets={byModel} />

      <h3 className="text-sm font-semibold mt-6 mb-2">Recent tasks</h3>
      <div className="space-y-2">
        {recent.length === 0 && (
          <div className="text-sm text-nexus-muted">No tasks yet. Start one from the Chat tab.</div>
        )}
        {taskCosts.map((tc) => {
          const t = tc.task;
          return (
            <div key={t.id} className="nx-card p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="nx-tag">{t.status}</span>
                <span className="font-medium truncate max-w-[28ch]">{t.title}</span>
                <span className="text-xs text-nexus-muted">{t.modelId}</span>
                <div className="flex-1" />
                <span className="text-xs tabular-nums text-nexus-muted">
                  {formatTokens(t.inputTokens ?? 0)} in / {formatTokens(t.outputTokens ?? 0)} out
                </span>
                <span className="text-xs tabular-nums font-medium">
                  {tc.priced ? formatUsd(tc.totalCostUsd) : "no price"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="nx-card p-3">
      <div className="text-xs uppercase tracking-wide text-nexus-muted">{label}</div>
      <div className="text-xl font-semibold tabular-nums mt-0.5">{value}</div>
      {hint && <div className="text-[11px] text-nexus-muted mt-0.5">{hint}</div>}
    </div>
  );
}

function Section({
  title,
  buckets,
  emptyText,
}: {
  title: string;
  buckets: UsageBucket[];
  emptyText?: string;
}) {
  if (buckets.length === 0) {
    if (!emptyText) return null;
    return (
      <div className="mb-4">
        <h3 className="text-sm font-semibold mb-2">{title}</h3>
        <div className="text-sm text-nexus-muted">{emptyText}</div>
      </div>
    );
  }
  const maxCost = Math.max(...buckets.map((b) => b.totalCostUsd), 0.0001);
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <div className="space-y-1.5">
        {buckets.map((b) => (
          <div key={b.key} className="nx-card p-2.5">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{b.label}</span>
              <div className="flex-1" />
              <span className="text-xs tabular-nums text-nexus-muted">
                {formatTokens(b.inputTokens)} in / {formatTokens(b.outputTokens)} out
              </span>
              <span className="text-xs tabular-nums font-semibold w-20 text-right">
                {formatUsd(b.totalCostUsd)}
              </span>
            </div>
            <div className="h-1 mt-1.5 rounded bg-nexus-surface-2 overflow-hidden">
              <div
                className="h-full bg-nexus-accent"
                style={{ width: `${Math.max(2, (b.totalCostUsd / maxCost) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
