import { extractSymbols, isSupportedForSymbols, type SymbolEntry } from "./symbolExtractor";

const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_WINDOW_LINES = 80;
const DEFAULT_OVERLAP_LINES = 10;

export interface ChunkerOptions {
  /** Maximum characters per chunk before forcing a split. */
  maxChars?: number;
  /** Window size for non-symbol chunking, in lines. */
  windowLines?: number;
  /** Overlap between adjacent windows, in lines. */
  overlapLines?: number;
}

export interface FileChunk {
  /** Workspace-relative POSIX path. */
  file: string;
  /** 1-based inclusive starting line. */
  startLine: number;
  /** 1-based inclusive ending line. */
  endLine: number;
  /** The chunk's text, never larger than `maxChars`. */
  content: string;
  /** Optional symbol name when the chunk corresponds to a single declaration. */
  symbolName?: string;
  /** Optional symbol kind (function/class/...). */
  symbolKind?: SymbolEntry["kind"];
}

/**
 * Split a file into chunks for embedding.
 *
 * Strategy:
 *   - For TS/JS/TSX/JSX (anything `isSupportedForSymbols` covers): use
 *     `extractSymbols` to find top-level declarations, and emit one chunk per
 *     symbol spanning from its declaration line up to the next symbol's line
 *     minus one (or end-of-file). Whatever sits before the first symbol
 *     becomes its own "header" chunk so imports / module-level code aren't
 *     dropped. Symbols whose body exceeds `maxChars` are subdivided by
 *     line-window with the same overlap rules as the generic path.
 *   - For everything else: a sliding line window with overlap.
 *
 * The chunker is content-only — it does not read files from disk. Callers
 * pass file content to keep this side-effect-free and easy to test.
 */
export function chunkFile(
  file: string,
  content: string,
  opts: ChunkerOptions = {},
): FileChunk[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const windowLines = opts.windowLines ?? DEFAULT_WINDOW_LINES;
  const overlapLines = opts.overlapLines ?? DEFAULT_OVERLAP_LINES;
  if (!content) return [];
  const lines = content.split("\n");
  const totalLines = lines.length;

  if (isSupportedForSymbols(file)) {
    const symbols = extractSymbols(file, content)
      .filter((s) => !s.container) // skip nested members; the top-level decl already covers them
      .sort((a, b) => a.line - b.line);
    if (symbols.length > 0) {
      return chunkBySymbols(file, lines, symbols, { maxChars, windowLines, overlapLines });
    }
  }
  return chunkByWindow(file, lines, 1, totalLines, { maxChars, windowLines, overlapLines });
}

function chunkBySymbols(
  file: string,
  lines: string[],
  symbols: SymbolEntry[],
  opts: Required<ChunkerOptions>,
): FileChunk[] {
  const out: FileChunk[] = [];
  // Emit a header chunk for everything before the first symbol.
  const firstLine = symbols[0].line;
  if (firstLine > 1) {
    pushSplit(out, file, lines, 1, firstLine - 1, opts);
  }
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    const next = symbols[i + 1];
    const endLine = next ? Math.max(sym.line, next.line - 1) : lines.length;
    const before = out.length;
    pushSplit(out, file, lines, sym.line, endLine, opts);
    // Tag the *first* chunk produced for this symbol with its name/kind so
    // search results can show "function fooBar:" prefixes.
    if (out.length > before) {
      out[before].symbolName = sym.name;
      out[before].symbolKind = sym.kind;
    }
  }
  return out;
}

function chunkByWindow(
  file: string,
  lines: string[],
  startLine: number,
  endLine: number,
  opts: Required<ChunkerOptions>,
): FileChunk[] {
  return pushSplit([], file, lines, startLine, endLine, opts);
}

function pushSplit(
  acc: FileChunk[],
  file: string,
  lines: string[],
  startLine: number,
  endLine: number,
  opts: Required<ChunkerOptions>,
): FileChunk[] {
  if (endLine < startLine) return acc;
  const span = sliceLines(lines, startLine, endLine);
  // Fast path: span fits in one chunk.
  if (span.length <= opts.maxChars && endLine - startLine + 1 <= opts.windowLines) {
    if (span.trim().length > 0) {
      acc.push({ file, startLine, endLine, content: span });
    }
    return acc;
  }
  // Sliding window with overlap.
  const stride = Math.max(1, opts.windowLines - opts.overlapLines);
  for (let s = startLine; s <= endLine; s += stride) {
    const e = Math.min(endLine, s + opts.windowLines - 1);
    const text = sliceLines(lines, s, e);
    if (text.length > opts.maxChars) {
      // Last-resort hard cap by characters.
      acc.push({ file, startLine: s, endLine: e, content: text.slice(0, opts.maxChars) });
    } else if (text.trim().length > 0) {
      acc.push({ file, startLine: s, endLine: e, content: text });
    }
    if (e === endLine) break;
  }
  return acc;
}

function sliceLines(lines: string[], start1: number, end1: number): string {
  // 1-based inclusive slice → 0-based half-open.
  const s = Math.max(0, start1 - 1);
  const e = Math.min(lines.length, end1);
  return lines.slice(s, e).join("\n");
}
