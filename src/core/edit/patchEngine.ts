import type { DiffHunk, DiffPreviewFile } from "../../shared/types";

/**
 * Tiny line-diff and patch utilities. Each hunk stores its full `beforeText`
 * and `afterText` so the webview can render and mask hunks without re-parsing
 * a unified-diff string. Final patch application is a simple concatenation of
 * either the before- or after-text for each hunk plus the surrounding context.
 */

interface InternalHunk {
  startLineBefore: number; // 1-based
  startLineAfter: number; // 1-based
  beforeLines: string[];
  afterLines: string[];
}

export function generateInternalHunks(before: string, after: string): InternalHunk[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const ops = diffLines(a, b);
  const hunks: InternalHunk[] = [];
  let aLine = 0;
  let bLine = 0;
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === "equal") {
      aLine += ops[i].lines.length;
      bLine += ops[i].lines.length;
      i++;
      continue;
    }
    const startA = aLine;
    const startB = bLine;
    const beforeLines: string[] = [];
    const afterLines: string[] = [];
    while (i < ops.length && ops[i].type !== "equal") {
      const op = ops[i];
      if (op.type === "remove") {
        beforeLines.push(...op.lines);
        aLine += op.lines.length;
      } else if (op.type === "add") {
        afterLines.push(...op.lines);
        bLine += op.lines.length;
      }
      i++;
    }
    hunks.push({ startLineBefore: startA + 1, startLineAfter: startB + 1, beforeLines, afterLines });
  }
  return hunks;
}

export function generateHunks(before: string, after: string): DiffHunk[] {
  return generateInternalHunks(before, after).map((h, i) => ({
    id: `h${i}`,
    startLineBefore: h.startLineBefore,
    startLineAfter: h.startLineAfter,
    beforeText: h.beforeLines.join("\n"),
    afterText: h.afterLines.join("\n"),
    accepted: null,
  }));
}

export function buildDiffPreview(filePath: string, before: string, after: string): DiffPreviewFile {
  const status: DiffPreviewFile["status"] = before === "" ? "created" : after === "" ? "deleted" : "modified";
  return {
    path: filePath,
    before,
    after,
    hunks: generateHunks(before, after),
    status,
  };
}

/**
 * Applies an accept/reject mask to a list of hunks. `accepted[i]` true means
 * keep `afterText`, false means keep `beforeText`. Context (unchanged lines)
 * is taken from `before`.
 */
export function applyHunkMask(before: string, hunks: DiffHunk[], accepted: boolean[]): string {
  if (hunks.length === 0) return before;
  const original = splitLines(before);
  const out: string[] = [];
  let cursor = 0;
  hunks.forEach((h, idx) => {
    const start = h.startLineBefore - 1;
    while (cursor < start) out.push(original[cursor++]);
    const beforeLines = h.beforeText ? h.beforeText.split("\n") : [];
    if (accepted[idx]) {
      const afterLines = h.afterText ? h.afterText.split("\n") : [];
      out.push(...afterLines);
    } else {
      out.push(...beforeLines);
    }
    cursor = start + beforeLines.length;
  });
  while (cursor < original.length) out.push(original[cursor++]);
  const trailing = before.endsWith("\n") ? "\n" : "";
  return out.join("\n") + trailing;
}

interface LineOp {
  type: "equal" | "add" | "remove";
  lines: string[];
}

/** Standard LCS-based line diff. O(n*m). Fine for the file sizes we see. */
function diffLines(a: string[], b: string[]): LineOp[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: LineOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pushOp(ops, "equal", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushOp(ops, "remove", a[i]);
      i++;
    } else {
      pushOp(ops, "add", b[j]);
      j++;
    }
  }
  while (i < n) pushOp(ops, "remove", a[i++]);
  while (j < m) pushOp(ops, "add", b[j++]);
  return ops;
}

function pushOp(ops: LineOp[], type: LineOp["type"], line: string): void {
  const last = ops[ops.length - 1];
  if (last && last.type === type) last.lines.push(line);
  else ops.push({ type, lines: [line] });
}

function splitLines(s: string): string[] {
  if (s === "") return [];
  const arr = s.split("\n");
  if (arr.length > 0 && arr[arr.length - 1] === "") arr.pop();
  return arr;
}
