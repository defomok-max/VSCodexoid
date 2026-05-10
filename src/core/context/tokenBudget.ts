/**
 * Quick char→token estimator. Real tokenization varies per provider; this is
 * a budget heuristic only — exact accounting happens server-side.
 *
 *   - English / code / JSON: ~4 chars per token
 *   - Mixed-language / cyrillic / CJK: ~2 chars per token (heuristic)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let total = 0;
  // Quick scan: count non-ASCII separately as 2 chars/token, ASCII as 4.
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 128) ascii++;
    else other++;
  }
  total = Math.ceil(ascii / 4) + Math.ceil(other / 2);
  return total;
}

/**
 * Truncates `text` so that the returned content is at most `tokenLimit`
 * tokens. Preserves the head + a trailing notice. For chunked context
 * assembly use `packChunks` below.
 */
export function truncateToTokens(text: string, tokenLimit: number): string {
  if (estimateTokens(text) <= tokenLimit) return text;
  // 1 token ≈ 4 ASCII chars; we head-truncate by char approximation.
  const charLimit = tokenLimit * 4;
  if (text.length <= charLimit) return text;
  return (
    text.slice(0, charLimit - 64) +
    "\n... [truncated for token budget; full content omitted]"
  );
}

export interface BudgetItem {
  id: string;
  priority: number; // higher = include first
  text: string;
}

/**
 * Greedy packer: picks items in priority order until the budget is filled.
 * Returns the included items and a byte-for-byte concatenated buffer with
 * `joiner` between them.
 */
export function packBudget(items: BudgetItem[], tokenLimit: number, joiner = "\n\n---\n\n"): {
  included: BudgetItem[];
  excluded: BudgetItem[];
  text: string;
  tokens: number;
} {
  const sorted = [...items].sort((a, b) => b.priority - a.priority);
  const included: BudgetItem[] = [];
  const excluded: BudgetItem[] = [];
  let used = 0;
  for (const it of sorted) {
    const cost = estimateTokens(it.text);
    if (used + cost <= tokenLimit) {
      included.push(it);
      used += cost;
    } else {
      excluded.push(it);
    }
  }
  // Restore original order to keep references in document order.
  const idIndex = new Map(items.map((it, idx) => [it.id, idx]));
  included.sort((a, b) => (idIndex.get(a.id) ?? 0) - (idIndex.get(b.id) ?? 0));
  return {
    included,
    excluded,
    text: included.map((it) => it.text).join(joiner),
    tokens: used,
  };
}
