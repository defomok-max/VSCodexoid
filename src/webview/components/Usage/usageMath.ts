import type { ProviderProfile, TaskRecord } from "../../../shared/types";

export interface UsageTotals {
  taskCount: number;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  /** Tasks that count toward `totalCostUsd` (i.e. had pricing data + token data). */
  pricedTaskCount: number;
}

export interface UsageBucket extends UsageTotals {
  /** Bucket key (e.g. providerId or modelId). */
  key: string;
  /** Display label. Mostly the same as `key`, but can carry a friendlier name. */
  label: string;
}

export interface TaskCost {
  task: TaskRecord;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  /** True if pricing was available for this task's provider. */
  priced: boolean;
}

/**
 * Look up `(costPerMillionInput, costPerMillionOutput)` for a task. Falls
 * back to the provider profile's defaults if both fields are present;
 * otherwise returns `undefined`.
 *
 * NOTE: today both inputs and outputs are billed against the provider
 * profile, not per-model. When we add per-model pricing (e.g. via
 * `ModelInfo.costPerMillion*`), this is the only place that needs to change.
 */
export function pricingFor(
  task: TaskRecord,
  providers: ProviderProfile[],
): { input: number; output: number } | undefined {
  const profile = providers.find((p) => p.id === task.providerId);
  if (!profile) return undefined;
  if (profile.costPerMillionInput === undefined || profile.costPerMillionOutput === undefined) {
    return undefined;
  }
  return {
    input: profile.costPerMillionInput,
    output: profile.costPerMillionOutput,
  };
}

export function costForTask(task: TaskRecord, providers: ProviderProfile[]): TaskCost {
  const pricing = pricingFor(task, providers);
  const inTok = task.inputTokens ?? 0;
  const outTok = task.outputTokens ?? 0;
  if (!pricing) {
    return { task, inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0, priced: false };
  }
  const inputCostUsd = (inTok / 1_000_000) * pricing.input;
  const outputCostUsd = (outTok / 1_000_000) * pricing.output;
  return {
    task,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
    priced: true,
  };
}

export function totalsFromTaskCosts(taskCosts: TaskCost[]): UsageTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalCostUsd = 0;
  let pricedTaskCount = 0;
  for (const c of taskCosts) {
    inputTokens += c.task.inputTokens ?? 0;
    outputTokens += c.task.outputTokens ?? 0;
    totalCostUsd += c.totalCostUsd;
    if (c.priced) pricedTaskCount += 1;
  }
  return {
    taskCount: taskCosts.length,
    inputTokens,
    outputTokens,
    totalCostUsd,
    pricedTaskCount,
  };
}

export function bucketBy(
  taskCosts: TaskCost[],
  pickKey: (t: TaskRecord) => string,
  pickLabel: (t: TaskRecord, key: string) => string = (_, k) => k,
): UsageBucket[] {
  const map = new Map<string, { label: string; tcs: TaskCost[] }>();
  for (const c of taskCosts) {
    const key = pickKey(c.task);
    if (!key) continue;
    const slot = map.get(key) ?? { label: pickLabel(c.task, key), tcs: [] };
    slot.tcs.push(c);
    map.set(key, slot);
  }
  const buckets: UsageBucket[] = [];
  for (const [key, slot] of map.entries()) {
    const t = totalsFromTaskCosts(slot.tcs);
    buckets.push({ key, label: slot.label, ...t });
  }
  buckets.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  return buckets;
}

export function aggregateUsage(
  tasks: TaskRecord[],
  providers: ProviderProfile[],
): {
  taskCosts: TaskCost[];
  totals: UsageTotals;
  byProvider: UsageBucket[];
  byModel: UsageBucket[];
} {
  const taskCosts = tasks.map((t) => costForTask(t, providers));
  const totals = totalsFromTaskCosts(taskCosts);
  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id;
  const byProvider = bucketBy(taskCosts, (t) => t.providerId, (t, k) => providerName(k));
  const byModel = bucketBy(taskCosts, (t) => t.modelId);
  return { taskCosts, totals, byProvider, byModel };
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});

export function formatUsd(amount: number): string {
  if (amount === 0) return "$0.00";
  return USD.format(amount);
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
