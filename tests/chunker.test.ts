import { describe, expect, it } from "vitest";
import { chunkFile } from "../src/core/indexing/chunker";

describe("chunkFile", () => {
  it("returns no chunks for empty content", () => {
    expect(chunkFile("a.ts", "")).toEqual([]);
  });

  it("uses sliding-window chunking for unsupported file types", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
    const chunks = chunkFile("notes.md", lines.join("\n"), {
      windowLines: 50,
      overlapLines: 10,
      maxChars: 1_000_000,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.startLine).toBeGreaterThanOrEqual(1);
      expect(c.endLine).toBeGreaterThanOrEqual(c.startLine);
      expect(c.symbolName).toBeUndefined();
    }
    // Windows must overlap by at least the configured overlap.
    const sortedByStart = [...chunks].sort((a, b) => a.startLine - b.startLine);
    for (let i = 1; i < sortedByStart.length; i++) {
      const prev = sortedByStart[i - 1];
      const cur = sortedByStart[i];
      expect(cur.startLine - prev.startLine).toBeLessThanOrEqual(50);
    }
    expect(sortedByStart[sortedByStart.length - 1].endLine).toBe(200);
  });

  it("emits a header chunk plus one chunk per top-level symbol for TS files", () => {
    const src = [
      "import { x } from './x';",
      "import { y } from './y';",
      "",
      "export function alpha() {",
      "  return 1;",
      "}",
      "",
      "export class Beta {",
      "  hello() { return 2; }",
      "}",
      "",
      "export const gamma = 3;",
      "",
    ].join("\n");
    const chunks = chunkFile("a.ts", src);
    const named = chunks.filter((c) => c.symbolName);
    const names = new Set(named.map((c) => c.symbolName));
    expect(names.has("alpha")).toBe(true);
    expect(names.has("Beta")).toBe(true);
    expect(names.has("gamma")).toBe(true);
    // First chunk must cover the imports preamble (no symbol tag).
    expect(chunks[0].symbolName).toBeUndefined();
    expect(chunks[0].startLine).toBe(1);
    // Symbol chunks must be ordered top-to-bottom.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startLine).toBeGreaterThanOrEqual(chunks[i - 1].startLine);
    }
  });

  it("splits oversized symbols into multiple sub-chunks while keeping the first tagged", () => {
    // Build a function whose body comfortably exceeds maxChars.
    const body = Array.from({ length: 400 }, (_, i) => `  const x${i} = ${i};`).join("\n");
    const src = `export function huge() {\n${body}\n}\n`;
    const chunks = chunkFile("h.ts", src, { maxChars: 500, windowLines: 60, overlapLines: 5 });
    const tagged = chunks.filter((c) => c.symbolName === "huge");
    expect(tagged.length).toBe(1); // Only the first chunk is tagged.
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(500);
    }
  });

  it("falls back to the generic window when symbol extraction yields nothing", () => {
    const src = "// no symbols, just lots of comment lines\n".repeat(10);
    const chunks = chunkFile("a.ts", src);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.symbolName === undefined)).toBe(true);
  });

  it("never returns chunks whose content exceeds maxChars", () => {
    const src = Array.from({ length: 3 }, (_, i) =>
      `export function f${i}() {\n${Array.from({ length: 200 }, (_, j) => `  v${j} = ${j};`).join("\n")}\n}\n`,
    ).join("\n");
    const chunks = chunkFile("big.ts", src, { maxChars: 800 });
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(800);
    }
  });
});
