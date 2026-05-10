import { describe, expect, it } from "vitest";
import { newId } from "../src/core/util/id";
import { builtInModes } from "../src/core/modes/builtInModes";

describe("scaffold sanity", () => {
  it("generates unique ids", () => {
    const a = newId("t");
    const b = newId("t");
    expect(a).not.toBe(b);
    expect(a.startsWith("t_")).toBe(true);
  });

  it("ships built-in modes", () => {
    expect(builtInModes.find((m) => m.id === "code")).toBeDefined();
    expect(builtInModes.find((m) => m.id === "ask")?.allowedTools).toContain("read_file");
  });
});
