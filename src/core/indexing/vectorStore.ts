import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Bumped when the on-disk schema changes. Old files are dropped on load. */
export const VECTOR_STORE_SCHEMA_VERSION = 1;

export interface VectorChunk {
  /** Stable id of the chunk within a file (e.g. `${rel}#${start}-${end}`). */
  id: string;
  /** Workspace-relative POSIX path. */
  file: string;
  /** 1-based inclusive line range. */
  startLine: number;
  endLine: number;
  /** Hash of the source span; used to skip re-embedding unchanged chunks. */
  contentHash: string;
  /** Optional symbol name / kind for nicer search hits. */
  symbolName?: string;
  symbolKind?: string;
  /** Embedding vector. */
  vector: Float32Array;
}

export interface VectorSearchHit {
  chunk: Omit<VectorChunk, "vector">;
  score: number;
}

export interface VectorStoreSnapshot {
  version: number;
  /** Provider-id + model used to compute the vectors. Mismatches force rebuild. */
  providerId: string;
  model: string;
  /** Common dimensionality of every vector. Mismatches force rebuild. */
  dimensions: number;
  chunks: VectorStoreChunkRecord[];
}

interface VectorStoreChunkRecord {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  contentHash: string;
  symbolName?: string;
  symbolKind?: string;
  vector: number[];
}

export interface VectorStoreOptions {
  providerId: string;
  model: string;
  dimensions: number;
  /** When set, snapshots are written here on `save()`. */
  snapshotPath?: string;
}

/**
 * In-memory flat-cosine vector store. Vectors are kept as `Float32Array`s for
 * cache locality during cosine-similarity scans. Persisted to disk as JSON
 * (numbers) on `save()`; on `load()` mismatched provider/model/dimensions
 * cause a soft reset (callers should rebuild).
 *
 * Search uses pre-normalized vectors (computed at insert time) so each scan
 * is a single `dot(query, doc)` per chunk — no per-chunk normalization on the
 * hot path.
 */
export class VectorStore {
  private chunks = new Map<string, VectorChunk>();
  private byFile = new Map<string, Set<string>>();
  private opts: VectorStoreOptions;

  constructor(opts: VectorStoreOptions) {
    if (!Number.isFinite(opts.dimensions) || opts.dimensions <= 0) {
      throw new Error(`invalid dimensions: ${opts.dimensions}`);
    }
    this.opts = opts;
  }

  get providerId(): string {
    return this.opts.providerId;
  }
  get model(): string {
    return this.opts.model;
  }
  get dimensions(): number {
    return this.opts.dimensions;
  }
  size(): number {
    return this.chunks.size;
  }

  has(id: string): boolean {
    return this.chunks.has(id);
  }

  get(id: string): VectorChunk | undefined {
    return this.chunks.get(id);
  }

  filesIndexed(): string[] {
    return [...this.byFile.keys()];
  }

  chunkIdsForFile(file: string): string[] {
    const ids = this.byFile.get(file);
    return ids ? [...ids] : [];
  }

  upsert(chunk: VectorChunk): void {
    if (chunk.vector.length !== this.opts.dimensions) {
      throw new Error(
        `vector dimensions mismatch: expected ${this.opts.dimensions}, got ${chunk.vector.length}`,
      );
    }
    const normalized = normalize(chunk.vector);
    const stored: VectorChunk = { ...chunk, vector: normalized };
    this.chunks.set(stored.id, stored);
    let bucket = this.byFile.get(stored.file);
    if (!bucket) {
      bucket = new Set();
      this.byFile.set(stored.file, bucket);
    }
    bucket.add(stored.id);
  }

  delete(id: string): boolean {
    const c = this.chunks.get(id);
    if (!c) return false;
    this.chunks.delete(id);
    const bucket = this.byFile.get(c.file);
    if (bucket) {
      bucket.delete(id);
      if (bucket.size === 0) this.byFile.delete(c.file);
    }
    return true;
  }

  removeFile(file: string): number {
    const bucket = this.byFile.get(file);
    if (!bucket) return 0;
    const n = bucket.size;
    for (const id of bucket) this.chunks.delete(id);
    this.byFile.delete(file);
    return n;
  }

  clear(): void {
    this.chunks.clear();
    this.byFile.clear();
  }

  /**
   * Cosine-similarity search. The provided `queryVector` need not be
   * normalized; we normalize it once before the scan.
   */
  search(queryVector: Float32Array | number[], k: number): VectorSearchHit[] {
    if (k <= 0 || this.chunks.size === 0) return [];
    const q = normalize(toFloat32(queryVector));
    if (q.length !== this.opts.dimensions) {
      throw new Error(
        `query dimensions mismatch: expected ${this.opts.dimensions}, got ${q.length}`,
      );
    }
    const heap: VectorSearchHit[] = [];
    for (const c of this.chunks.values()) {
      const score = dot(q, c.vector);
      if (heap.length < k) {
        heap.push({ chunk: stripVector(c), score });
        if (heap.length === k) heap.sort((a, b) => a.score - b.score);
      } else if (score > heap[0].score) {
        heap[0] = { chunk: stripVector(c), score };
        // Tiny: re-sort on every replacement. k is small (typically <= 100).
        heap.sort((a, b) => a.score - b.score);
      }
    }
    return heap.sort((a, b) => b.score - a.score);
  }

  toSnapshot(): VectorStoreSnapshot {
    return {
      version: VECTOR_STORE_SCHEMA_VERSION,
      providerId: this.opts.providerId,
      model: this.opts.model,
      dimensions: this.opts.dimensions,
      chunks: [...this.chunks.values()].map((c) => ({
        id: c.id,
        file: c.file,
        startLine: c.startLine,
        endLine: c.endLine,
        contentHash: c.contentHash,
        symbolName: c.symbolName,
        symbolKind: c.symbolKind,
        vector: Array.from(c.vector),
      })),
    };
  }

  loadSnapshot(snap: VectorStoreSnapshot): { ok: boolean; reason?: string } {
    if (snap.version !== VECTOR_STORE_SCHEMA_VERSION) {
      return { ok: false, reason: `schema-mismatch (${snap.version} != ${VECTOR_STORE_SCHEMA_VERSION})` };
    }
    if (snap.providerId !== this.opts.providerId) {
      return { ok: false, reason: `provider-mismatch (${snap.providerId} != ${this.opts.providerId})` };
    }
    if (snap.model !== this.opts.model) {
      return { ok: false, reason: `model-mismatch (${snap.model} != ${this.opts.model})` };
    }
    if (snap.dimensions !== this.opts.dimensions) {
      return { ok: false, reason: `dimensions-mismatch (${snap.dimensions} != ${this.opts.dimensions})` };
    }
    this.clear();
    for (const r of snap.chunks) {
      // Vectors loaded from disk are already normalized. Skip re-normalization
      // by writing directly to the maps.
      const v = new Float32Array(r.vector);
      const stored: VectorChunk = {
        id: r.id,
        file: r.file,
        startLine: r.startLine,
        endLine: r.endLine,
        contentHash: r.contentHash,
        symbolName: r.symbolName,
        symbolKind: r.symbolKind,
        vector: v,
      };
      this.chunks.set(stored.id, stored);
      let bucket = this.byFile.get(stored.file);
      if (!bucket) {
        bucket = new Set();
        this.byFile.set(stored.file, bucket);
      }
      bucket.add(stored.id);
    }
    return { ok: true };
  }

  async save(): Promise<void> {
    if (!this.opts.snapshotPath) return;
    const dir = path.dirname(this.opts.snapshotPath);
    await fs.mkdir(dir, { recursive: true });
    const snap = this.toSnapshot();
    await fs.writeFile(this.opts.snapshotPath, JSON.stringify(snap), "utf8");
  }

  async load(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.opts.snapshotPath) return { ok: false, reason: "no-snapshot-path" };
    let raw: string;
    try {
      raw = await fs.readFile(this.opts.snapshotPath, "utf8");
    } catch {
      return { ok: false, reason: "no-snapshot-on-disk" };
    }
    let snap: VectorStoreSnapshot;
    try {
      snap = JSON.parse(raw) as VectorStoreSnapshot;
    } catch {
      return { ok: false, reason: "snapshot-parse-error" };
    }
    return this.loadSnapshot(snap);
  }
}

function toFloat32(v: Float32Array | number[]): Float32Array {
  return v instanceof Float32Array ? v : Float32Array.from(v);
}

function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  if (sum === 0) return v.slice();
  const norm = Math.sqrt(sum);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function stripVector(c: VectorChunk): Omit<VectorChunk, "vector"> {
  const { vector: _vector, ...rest } = c;
  void _vector;
  return rest;
}

/**
 * Stable hash of a chunk's content. We fold in the file path + line range so
 * two chunks with identical text but different positions get distinct ids.
 */
export function hashChunkContent(file: string, startLine: number, endLine: number, content: string): string {
  const seed = `${file}@${startLine}-${endLine}\n`;
  return djb2(seed + content);
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(36);
}
