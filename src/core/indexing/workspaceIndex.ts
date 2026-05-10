import * as fs from "node:fs/promises";
import * as path from "node:path";
import { extractSymbols, isSupportedForSymbols, type SymbolEntry } from "./symbolExtractor";
import { InvertedIndex, type SearchHit } from "./lexicalSearch";

const MAX_INDEX_BYTES = 1 * 1024 * 1024; // 1 MB per file
const MAX_FILES = 5000;

export interface FileEntry {
  /** Workspace-relative POSIX path. */
  path: string;
  size: number;
  mtimeMs: number;
  contentHash: string;
  symbols: SymbolEntry[];
}

export interface SymbolHit extends SymbolEntry {
  /** Workspace-relative POSIX path the symbol was found in. */
  file: string;
}

export interface WorkspaceIndexStats {
  files: number;
  symbols: number;
  uniqueTerms: number;
  bytesIndexed: number;
}

export interface IndexBridge {
  /** Should mirror the global ignore matcher (.nexusignore + safe defaults). */
  isIgnored(absPath: string): boolean;
}

/**
 * In-memory workspace index. Holds a `FileEntry` per indexed file (with
 * extracted symbols) plus a lexical inverted index for full-text search.
 *
 * The index is best-effort: it caps per-file size at 1 MB, total file count
 * at 5000, skips ignored paths, and quietly drops binary-looking content.
 * It can be cheaply re-`refresh()`-ed; unchanged files (same `mtimeMs` and
 * content hash) are not re-tokenised.
 */
export class WorkspaceIndex {
  private root: string;
  private bridge: IndexBridge;
  private files = new Map<string, FileEntry>();
  private inverted = new InvertedIndex();
  private bytesIndexed = 0;
  private refreshing = false;

  constructor(root: string, bridge: IndexBridge) {
    this.root = path.resolve(root);
    this.bridge = bridge;
  }

  /** Re-scan the workspace from disk. Safe to call repeatedly. */
  async refresh(): Promise<WorkspaceIndexStats> {
    if (this.refreshing) {
      // Coalesce concurrent refreshes; return current snapshot.
      return this.stats();
    }
    this.refreshing = true;
    try {
      const seen = new Set<string>();
      const stack: string[] = [this.root];
      while (stack.length > 0 && seen.size < MAX_FILES) {
        const cur = stack.pop()!;
        let entries;
        try {
          entries = await fs.readdir(cur, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          if (seen.size >= MAX_FILES) break;
          const abs = path.join(cur, e.name);
          if (this.bridge.isIgnored(abs)) continue;
          if (e.isDirectory()) {
            stack.push(abs);
            continue;
          }
          const rel = toPosix(path.relative(this.root, abs));
          seen.add(rel);
          await this.indexFile(rel, abs);
        }
      }
      // Drop entries no longer present on disk.
      for (const rel of [...this.files.keys()]) {
        if (!seen.has(rel)) this.removeRelative(rel);
      }
      return this.stats();
    } finally {
      this.refreshing = false;
    }
  }

  /** Re-index a single file (or remove it if missing / now ignored). */
  async update(absPath: string): Promise<void> {
    const abs = path.resolve(absPath);
    if (this.bridge.isIgnored(abs)) {
      this.removeRelative(toPosix(path.relative(this.root, abs)));
      return;
    }
    const rel = toPosix(path.relative(this.root, abs));
    if (rel.startsWith("..")) return;
    await this.indexFile(rel, abs);
  }

  /** Drop a file from the index without touching disk. */
  remove(absPath: string): void {
    const rel = toPosix(path.relative(this.root, path.resolve(absPath)));
    this.removeRelative(rel);
  }

  /**
   * Find symbols whose name matches `name` (case-insensitive substring or
   * regex when `regex: true`). Optional `kind` narrows by symbol kind.
   */
  findSymbol(
    name: string,
    opts?: { kind?: SymbolEntry["kind"]; regex?: boolean; maxResults?: number },
  ): SymbolHit[] {
    const max = opts?.maxResults ?? 100;
    const matcher = buildNameMatcher(name, opts?.regex ?? false);
    const out: SymbolHit[] = [];
    for (const file of this.files.values()) {
      for (const s of file.symbols) {
        if (opts?.kind && s.kind !== opts.kind) continue;
        if (!matcher(s.name)) continue;
        out.push({ ...s, file: file.path });
        if (out.length >= max) return out;
      }
    }
    return out;
  }

  /** Lexical search over indexed file contents. */
  lexicalSearch(query: string, opts?: { maxResults?: number }): SearchHit[] {
    return this.inverted.search(query, opts?.maxResults ?? 50);
  }

  stats(): WorkspaceIndexStats {
    let symbols = 0;
    for (const f of this.files.values()) symbols += f.symbols.length;
    return {
      files: this.files.size,
      symbols,
      uniqueTerms: this.inverted.size().uniqueTerms,
      bytesIndexed: this.bytesIndexed,
    };
  }

  /** Visible to tests; returns a snapshot of file entries. */
  listFiles(): FileEntry[] {
    return [...this.files.values()];
  }

  private async indexFile(rel: string, abs: string): Promise<void> {
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      this.removeRelative(rel);
      return;
    }
    if (!stat.isFile()) return;
    if (stat.size > MAX_INDEX_BYTES) {
      this.removeRelative(rel);
      return;
    }
    const existing = this.files.get(rel);
    if (existing && existing.mtimeMs === stat.mtimeMs && existing.size === stat.size) {
      // Cheap fast-path: assume unchanged when both mtime and size match.
      return;
    }
    let content;
    try {
      content = await fs.readFile(abs, "utf8");
    } catch {
      this.removeRelative(rel);
      return;
    }
    if (looksBinary(content)) {
      this.removeRelative(rel);
      return;
    }
    const contentHash = simpleHash(content);
    if (existing && existing.contentHash === contentHash) return;
    if (existing) {
      this.bytesIndexed -= existing.size;
      this.inverted.remove(rel);
    }
    const symbols = isSupportedForSymbols(rel) ? extractSymbols(rel, content) : [];
    const entry: FileEntry = {
      path: rel,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      contentHash,
      symbols,
    };
    this.files.set(rel, entry);
    this.inverted.add(rel, content);
    this.bytesIndexed += stat.size;
  }

  private removeRelative(rel: string): void {
    const existing = this.files.get(rel);
    if (!existing) return;
    this.bytesIndexed -= existing.size;
    this.files.delete(rel);
    this.inverted.remove(rel);
  }
}

function buildNameMatcher(query: string, regex: boolean): (name: string) => boolean {
  if (regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, "i");
    } catch {
      return () => false;
    }
    return (name) => re.test(name);
  }
  const needle = query.toLowerCase();
  return (name) => name.toLowerCase().includes(needle);
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function looksBinary(s: string): boolean {
  return s.slice(0, 1024).indexOf("\u0000") !== -1;
}

/**
 * Tiny non-cryptographic hash (DJB2). We only use it to detect content
 * changes between refreshes; collisions are rare in practice and the
 * worst-case effect is a missed re-index, not data corruption.
 */
function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(36);
}
