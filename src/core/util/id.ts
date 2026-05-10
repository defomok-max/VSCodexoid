/**
 * Cheap, dependency-free unique-id generator suitable for in-process IDs (tasks,
 * messages, queue items, tool calls). Not cryptographically secure — do NOT use
 * for tokens or session IDs.
 */
export function newId(prefix = ""): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return prefix ? `${prefix}_${t}${r}` : `${t}${r}`;
}
