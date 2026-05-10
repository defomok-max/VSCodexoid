import { describe, expect, it } from "vitest";
import { ApprovalGate } from "../src/core/agent/approvalGate";

describe("ApprovalGate", () => {
  it("pairs request() with decide()", async () => {
    const g = new ApprovalGate();
    const p = g.request({ id: "r1", toolName: "x", argsPreview: "{}", riskLevel: "medium" });
    expect(g.isPending("r1")).toBe(true);
    g.decide({ id: "r1", approved: true });
    const decision = await p;
    expect(decision.approved).toBe(true);
    expect(g.isPending("r1")).toBe(false);
  });

  it("decide() returns false for unknown id", () => {
    const g = new ApprovalGate();
    expect(g.decide({ id: "missing", approved: true })).toBe(false);
  });

  it("cancelAll resolves every pending request as not-approved", async () => {
    const g = new ApprovalGate();
    const p1 = g.request({ id: "a", toolName: "x", argsPreview: "{}", riskLevel: "low" });
    const p2 = g.request({ id: "b", toolName: "y", argsPreview: "{}", riskLevel: "high" });
    g.cancelAll();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.approved).toBe(false);
    expect(r2.approved).toBe(false);
  });

  it("emits onRequest events", () => {
    const g = new ApprovalGate();
    const seen: string[] = [];
    g.onRequest((req) => seen.push(req.id));
    g.request({ id: "r", toolName: "z", argsPreview: "{}", riskLevel: "low" });
    expect(seen).toEqual(["r"]);
  });
});
