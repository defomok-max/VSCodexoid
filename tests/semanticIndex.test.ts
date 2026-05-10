import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SemanticIndex } from "../src/core/indexing/semanticIndex";
import type { EmbeddingsProvider } from "../src/core/providers/embeddingsProvider";

/**
 * Deterministic fake embeddings provider. Vectors are derived from the input
 * text alone, so chunks containing the same keyword (e.g. "alpha") cluster
 * together and the closest match for `query="alpha"` is the chunk that
 * mentions "alpha" the most.
 */
function makeEmbeddings(): EmbeddingsProvider & { calls: number } {
  let calls = 0;
  return {
    id: "fake",
    model: "fake-model",
    dimensions: 4,
    async embed(texts) {
      calls++;
      return texts.map((t) => featureVector(t));
    },
    get calls() {
      return calls;
    },
  } as EmbeddingsProvider & { calls: number };
}

function featureVector(text: string): number[] {
  const lower = text.toLowerCase();
  const counts = [
    countMatches(lower, "alpha"),
    countMatches(lower, "beta"),
    countMatches(lower, "gamma"),
    countMatches(lower, "delta"),
  ];
  // Add a tiny per-text bias so identical token-counts still differ slightly.
  const bias = (text.length % 10) * 0.001;
  return counts.map((c) => c + bias);
}

function countMatches(s: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while ((i = s.indexOf(needle, i)) !== -1) {
    n++;
    i += needle.length;
  }
  return n;
}

describe("SemanticIndex", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sem-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("indexes files and returns higher-scoring hits for matching queries", async () => {
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "src", "alpha.ts"),
      "export function alpha() { return 'alpha alpha alpha'; }\n",
    );
    await fs.writeFile(
      path.join(tmp, "src", "beta.ts"),
      "export function beta() { return 'beta beta beta'; }\n",
    );
    await fs.writeFile(
      path.join(tmp, "src", "gamma.ts"),
      "export function gamma() { return 'gamma gamma gamma'; }\n",
    );
    const idx = new SemanticIndex({
      root: tmp,
      bridge: { isIgnored: () => false },
      embeddings: makeEmbeddings(),
    });
    const stats = await idx.refresh();
    expect(stats.files).toBe(3);
    expect(stats.chunks).toBeGreaterThanOrEqual(3);
    const hits = await idx.search("alpha", { k: 2 });
    expect(hits[0].filePath).toBe("src/alpha.ts");
    expect(hits[0].score).toBeGreaterThan(hits[hits.length - 1].score - 0.0001);
  });

  it("respects ignored paths", async () => {
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.mkdir(path.join(tmp, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(tmp, "src", "alpha.ts"), "export const ALPHA = 'alpha';\n");
    await fs.writeFile(
      path.join(tmp, "node_modules", "ignored.ts"),
      "export const ALPHA = 'alpha alpha alpha alpha alpha';\n",
    );
    const idx = new SemanticIndex({
      root: tmp,
      bridge: { isIgnored: (p) => p.includes(`${path.sep}node_modules${path.sep}`) },
      embeddings: makeEmbeddings(),
    });
    await idx.refresh();
    const hits = await idx.search("alpha", { k: 5 });
    expect(hits.every((h) => !h.filePath.includes("node_modules"))).toBe(true);
  });

  it("reuses chunks whose content hash hasn't changed", async () => {
    await fs.writeFile(path.join(tmp, "a.ts"), "export const v = 'alpha alpha';\n");
    const emb = makeEmbeddings();
    const idx = new SemanticIndex({
      root: tmp,
      bridge: { isIgnored: () => false },
      embeddings: emb,
    });
    const first = await idx.refresh();
    expect(first.embeddedChunks).toBeGreaterThan(0);
    const callsAfterFirst = emb.calls;
    const second = await idx.refresh();
    expect(second.reusedChunks).toBeGreaterThan(0);
    expect(second.embeddedChunks).toBe(0);
    // No additional embeddings calls beyond the dimensionality probe (1) +
    // the first-refresh batches.
    expect(emb.calls).toBe(callsAfterFirst);
  });

  it("removes chunks for files that disappear between refreshes", async () => {
    await fs.writeFile(path.join(tmp, "a.ts"), "export const v = 'alpha';\n");
    await fs.writeFile(path.join(tmp, "b.ts"), "export const w = 'beta';\n");
    const idx = new SemanticIndex({
      root: tmp,
      bridge: { isIgnored: () => false },
      embeddings: makeEmbeddings(),
    });
    const first = await idx.refresh();
    expect(first.files).toBe(2);
    await fs.unlink(path.join(tmp, "b.ts"));
    const second = await idx.refresh();
    expect(second.files).toBe(1);
    expect(second.removedFiles).toBeGreaterThanOrEqual(1);
  });

  it("filters search hits by filePattern", async () => {
    await fs.mkdir(path.join(tmp, "agent"), { recursive: true });
    await fs.mkdir(path.join(tmp, "tools"), { recursive: true });
    await fs.writeFile(path.join(tmp, "agent", "a.ts"), "export const v = 'alpha alpha';\n");
    await fs.writeFile(path.join(tmp, "tools", "t.ts"), "export const v = 'alpha';\n");
    const idx = new SemanticIndex({
      root: tmp,
      bridge: { isIgnored: () => false },
      embeddings: makeEmbeddings(),
    });
    await idx.refresh();
    const hits = await idx.search("alpha", { filePattern: "agent" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.filePath.startsWith("agent/"))).toBe(true);
  });
});
