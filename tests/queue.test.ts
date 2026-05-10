import { describe, expect, it } from "vitest";
import { QueueManager } from "../src/core/agent/queueManager";

const baseItem = (text = "hello", priority = 0) => ({
  text,
  priority,
});

describe("QueueManager", () => {
  it("adds items with stable ids and createdAt", () => {
    const q = new QueueManager();
    const a = q.add(baseItem("a"));
    const b = q.add(baseItem("b"));
    expect(q.list()).toHaveLength(2);
    expect(a.id).not.toBe(b.id);
    expect(a.status === "queued" || a.status === "next").toBe(true);
  });

  it("removes by id", () => {
    const q = new QueueManager();
    const a = q.add(baseItem("a"));
    q.add(baseItem("b"));
    expect(q.remove(a.id)).toBe(true);
    expect(q.list()).toHaveLength(1);
  });

  it("edits item text", () => {
    const q = new QueueManager();
    const a = q.add(baseItem("old"));
    expect(q.edit(a.id, "new")).toBe(true);
    expect(q.list()[0].text).toBe("new");
  });

  it("moves up/down/top", () => {
    const q = new QueueManager();
    q.add(baseItem("a"));
    const b = q.add(baseItem("b"));
    q.add(baseItem("c"));
    q.move(b.id, "down");
    expect(q.list().map((i) => i.text)).toEqual(["a", "c", "b"]);
    q.move(b.id, "top");
    expect(q.list().map((i) => i.text)).toEqual(["b", "a", "c"]);
  });

  it("sendNow returns the popped item with the chosen behavior", () => {
    const q = new QueueManager();
    q.add(baseItem("a"));
    const b = q.add(baseItem("b"));
    const popped = q.sendNow(b.id, "interrupt-current");
    expect(popped?.item.text).toBe("b");
    expect(popped?.behavior).toBe("interrupt-current");
    expect(q.list()).toHaveLength(1);
  });

  it("sendNow high-priority-next keeps the item and promotes it", () => {
    const q = new QueueManager();
    q.add(baseItem("a", 1));
    const b = q.add(baseItem("b", 0));
    const popped = q.sendNow(b.id, "high-priority-next");
    expect(popped?.item.text).toBe("b");
    expect(q.list()).toHaveLength(2);
    expect(q.list().find((i) => i.status === "next")?.id).toBe(b.id);
  });

  it("popNext returns nothing when paused", () => {
    const q = new QueueManager();
    q.add(baseItem("a"));
    q.setPaused(true);
    expect(q.popNext()).toBeUndefined();
    q.setPaused(false);
    expect(q.popNext()?.text).toBe("a");
  });

  it("refreshes `next` to the highest-priority item", () => {
    const q = new QueueManager();
    q.add(baseItem("low", 1));
    q.add(baseItem("high", 10));
    const list = q.list();
    const next = list.find((i) => i.status === "next");
    expect(next?.text).toBe("high");
  });

  it("clear removes all", () => {
    const q = new QueueManager();
    q.add(baseItem("a"));
    q.add(baseItem("b"));
    q.clear();
    expect(q.list()).toHaveLength(0);
  });
});
