import { describe, expect, it } from "vitest";
import {
  isDiffSessionResolved,
  materializeAcceptedFiles,
  setAllDecision,
  setFileDecision,
  setHunkDecision,
  type DiffSession,
} from "../src/core/edit/diffSession";
import { buildDiffPreview } from "../src/core/edit/patchEngine";

function session(): DiffSession {
  return {
    taskId: "task-1",
    files: [
      buildDiffPreview("a.txt", "one\ntwo\nthree\n", "one\nTWO\nthree\n"),
      buildDiffPreview("b.txt", "old\n", "new\n"),
    ],
  };
}

describe("diffSession", () => {
  it("marks a single hunk decision without mutating the original session", () => {
    const s = session();
    const next = setHunkDecision(s, "a.txt", "h0", true).session!;
    expect(next.files[0].hunks[0].accepted).toBe(true);
    expect(s.files[0].hunks[0].accepted).toBeNull();
  });

  it("marks every hunk in one file", () => {
    const next = setFileDecision(session(), "a.txt", false).session!;
    expect(next.files[0].hunks.every((h) => h.accepted === false)).toBe(true);
    expect(next.files[1].hunks.every((h) => h.accepted === null)).toBe(true);
  });

  it("marks every hunk in every file", () => {
    const next = setAllDecision(session(), true);
    expect(next.files.every((file) => file.hunks.every((h) => h.accepted === true))).toBe(true);
  });

  it("reports resolved only when all hunks have decisions", () => {
    expect(isDiffSessionResolved(session())).toBe(false);
    expect(isDiffSessionResolved(setAllDecision(session(), false))).toBe(true);
  });

  it("materializes only accepted file changes", () => {
    const first = setFileDecision(session(), "a.txt", true).session!;
    const resolved = setFileDecision(first, "b.txt", false).session!;
    const files = materializeAcceptedFiles(resolved);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("a.txt");
    expect(files[0].after).toBe("one\nTWO\nthree\n");
  });
});
