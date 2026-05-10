import { describe, expect, it } from "vitest";
import { TaskManager } from "../src/core/agent/taskManager";

describe("TaskManager", () => {
  it("creates a task with sane defaults", () => {
    const tm = new TaskManager();
    const t = tm.create({ prompt: "hi", modeId: "code", providerId: "openai", modelId: "gpt-5" });
    expect(t.id).toMatch(/^task_/);
    expect(t.status).toBe("pending");
    expect(t.title).toBe("hi");
    expect(t.startedAt).toBeGreaterThan(0);
  });

  it("derives a sane title from the first line of the prompt", () => {
    const tm = new TaskManager();
    const t = tm.create({
      prompt: "fix the login bug\nbut also add a regression test",
      modeId: "code",
      providerId: "p",
      modelId: "m",
    });
    expect(t.title).toBe("fix the login bug");
  });

  it("appendMessage and recordToolCall update the live record", () => {
    const tm = new TaskManager();
    const t = tm.create({ prompt: "x", modeId: "code", providerId: "p", modelId: "m" });
    tm.appendMessage(t.id, { id: "m1", role: "assistant", content: "ok", ts: Date.now() });
    tm.recordToolCall(t.id, { id: "tc1", name: "read_file", args: {}, startedAt: Date.now() });
    const updated = tm.get(t.id)!;
    expect(updated.messages).toHaveLength(1);
    expect(updated.toolCalls).toHaveLength(1);
  });

  it("setStatus tags endedAt for terminal states", () => {
    const tm = new TaskManager();
    const t = tm.create({ prompt: "x", modeId: "code", providerId: "p", modelId: "m" });
    tm.setStatus(t.id, "completed");
    expect(tm.get(t.id)!.endedAt).toBeGreaterThan(0);
  });

  it("emits onUpdate listeners", () => {
    const tm = new TaskManager();
    let count = 0;
    tm.onUpdate(() => count++);
    const t = tm.create({ prompt: "x", modeId: "code", providerId: "p", modelId: "m" });
    tm.setStatus(t.id, "running");
    tm.appendMessage(t.id, { id: "m1", role: "user", content: "hi", ts: 0 });
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
