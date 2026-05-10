/**
 * Tiny in-memory inverted index for lexical search across workspace files.
 *
 * Tokenizer keeps ASCII identifier-ish tokens (`[a-z0-9_]+`) of length 2..40,
 * lowercased. Scoring is a simplified TF·IDF: per-document term frequency
 * weighted by `log(1 + N / df)` where `N` is the total document count and
 * `df` is the number of documents containing the term. Good enough to rank
 * "relevant files" for the agent without dragging in a real search library.
 */
export interface SearchHit {
  /** Workspace-relative POSIX path. */
  path: string;
  score: number;
}

export class InvertedIndex {
  /** term → file → frequency */
  private termToFiles = new Map<string, Map<string, number>>();
  /** file → set of terms (used for cheap removal) */
  private fileToTerms = new Map<string, Set<string>>();

  add(file: string, content: string): void {
    if (this.fileToTerms.has(file)) this.remove(file);
    const freqs = new Map<string, number>();
    for (const t of tokenize(content)) {
      freqs.set(t, (freqs.get(t) ?? 0) + 1);
    }
    if (freqs.size === 0) return;
    this.fileToTerms.set(file, new Set(freqs.keys()));
    for (const [term, freq] of freqs) {
      let entry = this.termToFiles.get(term);
      if (!entry) {
        entry = new Map();
        this.termToFiles.set(term, entry);
      }
      entry.set(file, freq);
    }
  }

  remove(file: string): void {
    const terms = this.fileToTerms.get(file);
    if (!terms) return;
    this.fileToTerms.delete(file);
    for (const term of terms) {
      const entry = this.termToFiles.get(term);
      if (!entry) continue;
      entry.delete(file);
      if (entry.size === 0) this.termToFiles.delete(term);
    }
  }

  search(query: string, maxResults = 50): SearchHit[] {
    const terms = Array.from(new Set(tokenize(query)));
    if (terms.length === 0) return [];
    const totalDocs = this.fileToTerms.size || 1;
    const scores = new Map<string, number>();
    for (const term of terms) {
      const entry = this.termToFiles.get(term);
      if (!entry) continue;
      const idf = Math.log(1 + totalDocs / entry.size);
      for (const [file, freq] of entry) {
        scores.set(file, (scores.get(file) ?? 0) + freq * idf);
      }
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxResults)
      .map(([path, score]) => ({ path, score }));
  }

  size(): { uniqueTerms: number; files: number } {
    return { uniqueTerms: this.termToFiles.size, files: this.fileToTerms.size };
  }

  clear(): void {
    this.termToFiles.clear();
    this.fileToTerms.clear();
  }
}

const TOKEN_RE = /[a-z0-9_]+/g;

export function tokenize(s: string): string[] {
  const lower = s.toLowerCase();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(lower))) {
    const tok = m[0];
    if (tok.length >= 2 && tok.length <= 40) out.push(tok);
  }
  return out;
}
