import { describe, expect, it } from "vitest";
import { applyHunkMask, buildDiffPreview, generateHunks } from "../src/core/edit/patchEngine";

describe("generateHunks", () => {
  it("returns no hunks for identical content", () => {
    expect(generateHunks("a\nb\nc", "a\nb\nc")).toHaveLength(0);
  });

  it("produces a single hunk for a one-line edit", () => {
    const before = "a\nb\nc\nd\ne\n";
    const after = "a\nB\nc\nd\ne\n";
    const hunks = generateHunks(before, after);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].beforeText).toBe("b");
    expect(hunks[0].afterText).toBe("B");
    expect(hunks[0].startLineBefore).toBe(2);
  });

  it("records accurate line numbers", () => {
    const before = "x\ny\nz\n";
    const after = "x\ny2\nz\n";
    const [hunk] = generateHunks(before, after);
    expect(hunk.startLineBefore).toBe(2);
    expect(hunk.startLineAfter).toBe(2);
  });
});

describe("buildDiffPreview", () => {
  it("attaches stable hunk ids", () => {
    const preview = buildDiffPreview("a.txt", "1\n2\n3\n", "1\n2\nx\n");
    expect(preview.hunks[0].id).toBe("h0");
  });
});

describe("applyHunkMask", () => {
  it("returns input unchanged when there are no hunks", () => {
    expect(applyHunkMask("hello", [], [])).toBe("hello");
  });

  it("applies all hunks when fully accepted", () => {
    const before = "a\nb\nc\n";
    const after = "a\nB\nc\n";
    const hunks = generateHunks(before, after);
    const result = applyHunkMask(before, hunks, hunks.map(() => true));
    expect(result).toBe(after);
  });

  it("keeps original lines when a hunk is rejected", () => {
    const before = "a\nb\nc\n";
    const after = "a\nB\nc\n";
    const hunks = generateHunks(before, after);
    const result = applyHunkMask(before, hunks, hunks.map(() => false));
    expect(result).toBe(before);
  });
});
