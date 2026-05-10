/**
 * Lightweight parser for `@kind:value` references inside chat messages.
 * Examples:
 *   - `@file:src/main.ts`
 *   - `@folder:src/`
 *   - `@symbol:MyClass.method`
 *   - `@terminal` (last terminal output)
 *   - `@problems` (workspace diagnostics)
 *   - `@gitdiff[:HEAD~1]`
 *   - `@openfiles`
 */
export type ContextRefKind =
  | "file"
  | "folder"
  | "symbol"
  | "terminal"
  | "problems"
  | "gitdiff"
  | "openfiles";

export interface ContextReference {
  kind: ContextRefKind;
  value?: string; // optional argument (e.g. file path, ref name)
  /** position in the original message — useful for highlighting in UI. */
  start: number;
  end: number;
  /** the full matched literal (including the leading `@`). */
  raw: string;
}

const TOKEN_RE = /(?<![A-Za-z0-9_])@(file|folder|symbol|terminal|problems|gitdiff|openfiles)(?::([^\s)\]]+))?/g;

export function parseContextRefs(message: string): ContextReference[] {
  const out: ContextReference[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(message))) {
    out.push({
      kind: m[1] as ContextRefKind,
      value: m[2],
      start: m.index,
      end: m.index + m[0].length,
      raw: m[0],
    });
  }
  return out;
}

/** Strips all `@...` references from the message, returning the cleaned text. */
export function stripContextRefs(message: string): string {
  return message.replace(TOKEN_RE, "").replace(/\s{2,}/g, " ").trim();
}
