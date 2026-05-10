import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hashChunkContent,
  VectorStore,
  type VectorChunk,
} from "../src/core/indexing/vectorStore";

function makeVector(d: number, fill: (i: number) => number): Float32Array {
  const v = new Float32Array(d);
  for (let i = 0; i < d; i++) v[i] = fill(i);
  return v;
}

function chunk(
  id: string,
  file: string,
  start: number,
  end: number,
  vector: Float32Array,
): VectorChunk {
  return {
    id,
    file,
    startLine: start,
    endLine: end,
    contentHash: hashChunkContent(file, start, end, `${id}-content`),
    vector,
  };
}

describe("VectorStore", () => {
  it("rejects vectors with the wrong dimensionality", () => {
    const store = new VectorStore({ providerId: "p", model: "m", dimensions: 3 });
    expect(() =>
      store.upsert(chunk("a", "a.ts", 1, 1, makeVector(2, () => 1))),
    ).toThrow(/dimensions mismatch/);
  });

  it("ranks by cosine similarity", () => {
    const store = new VectorStore({ providerId: "p", model: "m", dimensions: 3 });
    store.upsert(chunk("a", "a.ts", 1, 1, new Float32Array([1, 0, 0])));
    store.upsert(chunk("b", "b.ts", 1, 1, new Float32Array([0, 1, 0])));
    store.upsert(chunk("c", "c.ts", 1, 1, new Float32Array([1, 1, 0])));
    const hits = store.search(new Float32Array([1, 0, 0]), 3);
    expect(hits.map((h) => h.chunk.id)).toEqual(["a", "c", "b"]);
    expect(hits[0].score).toBeCloseTo(1, 5);
  });

  it("returns the top-k highest-similarity chunks", () => {
    const store = new VectorStore({ providerId: "p", model: "m", dimensions: 4 });
    for (let i = 0; i < 30; i++) {
      const v = new Float32Array([Math.cos(i), Math.sin(i), 0, 0]);
      store.upsert(chunk(`c${i}`, "x.ts", i, i, v));
    }
    const hits = store.search(new Float32Array([1, 0, 0, 0]), 5);
    expect(hits).toHaveLength(5);
    const scores = hits.map((h) => h.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  it("removes by id and by file", () => {
    const store = new VectorStore({ providerId: "p", model: "m", dimensions: 2 });
    store.upsert(chunk("a", "a.ts", 1, 1, new Float32Array([1, 0])));
    store.upsert(chunk("b", "a.ts", 2, 2, new Float32Array([0, 1])));
    store.upsert(chunk("c", "b.ts", 1, 1, new Float32Array([1, 1])));
    expect(store.delete("a")).toBe(true);
    expect(store.delete("missing")).toBe(false);
    expect(store.size()).toBe(2);
    const removed = store.removeFile("b.ts");
    expect(removed).toBe(1);
    expect(store.size()).toBe(1);
  });

  it("round-trips through a JSON snapshot", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vstore-"));
    try {
      const file = path.join(dir, "snap.json");
      const a = new VectorStore({ providerId: "p", model: "m", dimensions: 2, snapshotPath: file });
      a.upsert(chunk("x", "x.ts", 1, 1, new Float32Array([3, 4])));
      a.upsert(chunk("y", "y.ts", 1, 1, new Float32Array([0, 1])));
      await a.save();

      const b = new VectorStore({ providerId: "p", model: "m", dimensions: 2, snapshotPath: file });
      const r = await b.load();
      expect(r.ok).toBe(true);
      expect(b.size()).toBe(2);
      const hits = b.search(new Float32Array([1, 0]), 2);
      // Vector "x" was [3,4]; normalized to [0.6, 0.8]; dot with [1,0] = 0.6.
      expect(hits[0].chunk.id).toBe("x");
      expect(hits[0].score).toBeCloseTo(0.6, 5);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects snapshots with mismatched provider/model/dimensions", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vstore-mm-"));
    try {
      const file = path.join(dir, "snap.json");
      const a = new VectorStore({ providerId: "p", model: "m", dimensions: 2, snapshotPath: file });
      a.upsert(chunk("x", "x.ts", 1, 1, new Float32Array([1, 0])));
      await a.save();
      const b = new VectorStore({ providerId: "OTHER", model: "m", dimensions: 2, snapshotPath: file });
      const r = await b.load();
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/provider-mismatch/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("hashChunkContent", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "hash-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("differs when path or range or content changes", () => {
    const a = hashChunkContent("a.ts", 1, 10, "body");
    const b = hashChunkContent("b.ts", 1, 10, "body");
    const c = hashChunkContent("a.ts", 1, 11, "body");
    const d = hashChunkContent("a.ts", 1, 10, "different");
    expect(new Set([a, b, c, d]).size).toBe(4);
    // Stable for identical inputs.
    expect(hashChunkContent("a.ts", 1, 10, "body")).toBe(a);
  });
});
