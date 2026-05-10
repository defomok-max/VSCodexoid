import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { EmbeddingsProvider } from "../providers/embeddingsProvider";
import { chunkFile, type ChunkerOptions, type FileChunk } from "./chunker";
import {
  hashChunkContent,
  VectorStore,
  type VectorChunk,
  type VectorSearchHit,
} from "./vectorStore";
import type { IndexBridge } from "./workspaceIndex";

const MAX_INDEX_BYTES = 1 * 1024 * 1024;
const MAX_FILES = 5000;
const DEFAULT_BATCH_SIZE = 32;

export interface SemanticIndexBuildStats {
  files: number;
  chunks: number;
  embeddedChunks: number;
  reusedChunks: number;
  removedFiles: number;
}

export interface SemanticIndexSearchHit {
  filePath: string;
  startLine: number;
  endLine: number;
  score: number;
  symbolName?: string;
  symbolKind?: string;
  /** A short snippet read from the live file at search time. */
  snippet: string;
}

export interface SemanticIndexOptions {
  root: string;
  bridge: IndexBridge;
  embeddings: EmbeddingsProvider;
  /** Persists vector snapshots to disk. Optional. */
  snapshotPath?: string;
  /** Number of texts per embeddings batch. */
  batchSize?: number;
  /** Override chunking knobs. */
  chunker?: ChunkerOptions;
  /** Apikey passthrough for the embeddings provider. */
  apiKey?: string;
  /** Optional logger; defaults to a no-op. */
  log?: (msg: string) => void;
}

export interface SemanticIndexRefreshOptions {
  signal?: AbortSignal;
  /** When true, ignore on-disk snapshot and rebuild from scratch. */
  force?: boolean;
}

export interface SemanticIndexSearchOptions {
  k?: number;
  signal?: AbortSignal;
  /** Optional case-insensitive substring filter on file paths. */
  filePattern?: string;
  /** Snippet character cap. Default 800. */
  maxSnippetChars?: number;
}

/**
 * Orchestrates "build chunks → embed → store vectors → search" against a
 * workspace. Mirrors `WorkspaceIndex` for the lexical side: best-effort,
 * size-capped, abort-aware, ignore-aware.
 *
 * The store is lazy: `refresh()` must be called once before `search()`
 * returns hits. Concurrent calls coalesce.
 */
export class SemanticIndex {
  private readonly root: string;
  private readonly bridge: IndexBridge;
  private readonly embeddings: EmbeddingsProvider;
  private readonly batchSize: number;
  private readonly chunkerOpts: ChunkerOptions | undefined;
  private readonly apiKey: string | undefined;
  private readonly log: (msg: string) => void;
  private store: VectorStore | undefined;
  private readonly snapshotPath: string | undefined;
  private refreshing: Promise<SemanticIndexBuildStats> | undefined;
  private dimensions: number | undefined;

  constructor(opts: SemanticIndexOptions) {
    this.root = path.resolve(opts.root);
    this.bridge = opts.bridge;
    this.embeddings = opts.embeddings;
    this.batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE);
    this.chunkerOpts = opts.chunker;
    this.snapshotPath = opts.snapshotPath;
    this.apiKey = opts.apiKey;
    this.log = opts.log ?? (() => {});
    this.dimensions = opts.embeddings.dimensions;
  }

  ready(): boolean {
    return this.store !== undefined;
  }

  size(): number {
    return this.store?.size() ?? 0;
  }

  filesIndexed(): number {
    return this.store?.filesIndexed().length ?? 0;
  }

  /**
   * Walk the workspace, chunk every supported file, embed missing chunks, and
   * persist the resulting vector store.
   */
  async refresh(opts: SemanticIndexRefreshOptions = {}): Promise<SemanticIndexBuildStats> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh(opts).finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  /** Return top-k semantic hits for the query string. */
  async search(
    query: string,
    opts: SemanticIndexSearchOptions = {},
  ): Promise<SemanticIndexSearchHit[]> {
    if (!this.store || this.store.size() === 0) return [];
    const k = Math.max(1, Math.min(200, opts.k ?? 10));
    const [vec] = await this.embeddings.embed([query], {
      apiKey: this.apiKey,
      signal: opts.signal,
    });
    if (!vec) return [];
    let hits: VectorSearchHit[] = this.store.search(vec, k * 4);
    if (opts.filePattern) {
      const pat = opts.filePattern.toLowerCase();
      hits = hits.filter((h) => h.chunk.file.toLowerCase().includes(pat));
    }
    hits = hits.slice(0, k);
    const out: SemanticIndexSearchHit[] = [];
    const cap = Math.max(120, Math.min(8000, opts.maxSnippetChars ?? 800));
    for (const h of hits) {
      const snippet = await this.readSnippet(h.chunk.file, h.chunk.startLine, h.chunk.endLine, cap);
      out.push({
        filePath: h.chunk.file,
        startLine: h.chunk.startLine,
        endLine: h.chunk.endLine,
        score: h.score,
        symbolName: h.chunk.symbolName,
        symbolKind: h.chunk.symbolKind,
        snippet,
      });
    }
    return out;
  }

  private async doRefresh(
    opts: SemanticIndexRefreshOptions,
  ): Promise<SemanticIndexBuildStats> {
    const ensured = await this.ensureStore(opts);
    const store = ensured;
    const seenFiles = new Set<string>();
    const stats: SemanticIndexBuildStats = {
      files: 0,
      chunks: 0,
      embeddedChunks: 0,
      reusedChunks: 0,
      removedFiles: 0,
    };
    let pending: Array<{ chunk: VectorChunk; text: string }> = [];

    const flush = async (): Promise<void> => {
      if (pending.length === 0) return;
      throwIfAborted(opts.signal);
      const texts = pending.map((p) => p.text);
      const vectors = await this.embeddings.embed(texts, {
        apiKey: this.apiKey,
        signal: opts.signal,
      });
      if (vectors.length !== pending.length) {
        throw new Error(
          `embeddings batch size mismatch: expected ${pending.length}, got ${vectors.length}`,
        );
      }
      for (let i = 0; i < pending.length; i++) {
        const dim = vectors[i].length;
        if (this.dimensions === undefined) this.dimensions = dim;
        if (dim !== store.dimensions) {
          throw new Error(
            `embedding dimensions changed mid-refresh: store=${store.dimensions}, got=${dim}`,
          );
        }
        const c: VectorChunk = { ...pending[i].chunk, vector: Float32Array.from(vectors[i]) };
        store.upsert(c);
        stats.embeddedChunks++;
      }
      pending = [];
    };

    const stack: string[] = [this.root];
    while (stack.length > 0 && seenFiles.size < MAX_FILES) {
      throwIfAborted(opts.signal);
      const cur = stack.pop()!;
      let entries;
      try {
        entries = await fs.readdir(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (seenFiles.size >= MAX_FILES) break;
        const abs = path.join(cur, e.name);
        if (this.bridge.isIgnored(abs)) continue;
        if (e.isDirectory()) {
          stack.push(abs);
          continue;
        }
        const rel = toPosix(path.relative(this.root, abs));
        if (rel.startsWith("..")) continue;
        await this.handleFile(rel, abs, store, stats, seenFiles, pending, flush);
      }
    }
    await flush();

    // Drop entries for files that have disappeared / become ignored.
    const onDisk = new Set(seenFiles);
    for (const file of store.filesIndexed()) {
      if (!onDisk.has(file)) {
        store.removeFile(file);
        stats.removedFiles++;
      }
    }
    stats.files = onDisk.size;
    stats.chunks = store.size();
    if (this.snapshotPath) {
      try {
        await store.save();
      } catch (err) {
        this.log(`semantic-index: failed to save snapshot: ${(err as Error).message}`);
      }
    }
    return stats;
  }

  private async handleFile(
    rel: string,
    abs: string,
    store: VectorStore,
    stats: SemanticIndexBuildStats,
    seen: Set<string>,
    pending: Array<{ chunk: VectorChunk; text: string }>,
    flush: () => Promise<void>,
  ): Promise<void> {
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      return;
    }
    if (!stat.isFile()) return;
    if (stat.size === 0 || stat.size > MAX_INDEX_BYTES) return;
    let content: string;
    try {
      content = await fs.readFile(abs, "utf8");
    } catch {
      return;
    }
    if (looksBinary(content)) return;
    seen.add(rel);
    const chunks = chunkFile(rel, content, this.chunkerOpts);
    const seenIds = new Set<string>();
    for (const c of chunks) {
      const hash = hashChunkContent(c.file, c.startLine, c.endLine, c.content);
      const id = `${c.file}#${c.startLine}-${c.endLine}#${hash}`;
      seenIds.add(id);
      const existing = store.get(id);
      if (existing && existing.contentHash === hash) {
        stats.reusedChunks++;
        continue;
      }
      pending.push({
        chunk: chunkToVector(id, c, hash),
        text: buildEmbeddingPayload(c),
      });
      if (pending.length >= this.batchSize) {
        await flush();
      }
    }
    // Drop chunks for this file that no longer exist (file shrank / refactored).
    for (const oldId of store.chunkIdsForFile(rel)) {
      if (!seenIds.has(oldId)) store.delete(oldId);
    }
  }

  private async ensureStore(opts: SemanticIndexRefreshOptions): Promise<VectorStore> {
    if (this.store) return this.store;
    if (this.dimensions === undefined) {
      // Trigger a one-shot embedding to discover the dimensionality.
      const [vec] = await this.embeddings.embed(["NexusCode dimensionality probe"], {
        apiKey: this.apiKey,
        signal: opts.signal,
      });
      if (!vec || vec.length === 0) {
        throw new Error("embeddings provider returned empty vector during init");
      }
      this.dimensions = vec.length;
    }
    const store = new VectorStore({
      providerId: this.embeddings.id,
      model: this.embeddings.model,
      dimensions: this.dimensions,
      snapshotPath: this.snapshotPath,
    });
    if (!opts.force && this.snapshotPath) {
      const loaded = await store.load();
      if (!loaded.ok) {
        this.log(`semantic-index: starting fresh (${loaded.reason ?? "load-failed"})`);
      }
    }
    this.store = store;
    return store;
  }

  private async readSnippet(
    rel: string,
    startLine: number,
    endLine: number,
    cap: number,
  ): Promise<string> {
    const abs = path.join(this.root, rel);
    let content: string;
    try {
      content = await fs.readFile(abs, "utf8");
    } catch {
      return "";
    }
    const lines = content.split("\n");
    const span = lines.slice(Math.max(0, startLine - 1), endLine).join("\n");
    return span.length > cap ? span.slice(0, cap) + "\n…" : span;
  }
}

function buildEmbeddingPayload(c: FileChunk): string {
  // Embeddings benefit from a compact natural-language preamble so two chunks
  // with identical bodies but different paths embed to different points.
  const symbol = c.symbolName ? `${c.symbolKind ?? "symbol"} ${c.symbolName}\n` : "";
  return `File: ${c.file}\nLines ${c.startLine}-${c.endLine}\n${symbol}\n${c.content}`;
}

function chunkToVector(id: string, c: FileChunk, hash: string): VectorChunk {
  return {
    id,
    file: c.file,
    startLine: c.startLine,
    endLine: c.endLine,
    contentHash: hash,
    symbolName: c.symbolName,
    symbolKind: c.symbolKind,
    // Replaced after embedding; this is just a placeholder.
    vector: new Float32Array(0),
  };
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function looksBinary(s: string): boolean {
  return s.slice(0, 1024).indexOf("\u0000") !== -1;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  }
}
