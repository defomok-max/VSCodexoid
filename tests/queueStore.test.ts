import { describe, expect, it } from "vitest";
import { QueueStore } from "../src/core/storage/queueStore";
import { QueueManager } from "../src/core/agent/queueManager";
import type { QueueItem } from "../src/shared/types";

class FakeMemento {
  private data = new Map<string, unknown>();
  get<T>(key: string, fallback?: T): T {
    return (this.data.has(key) ? this.data.get(key) : fallback) as T;
  }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.data.delete(key);
    else this.data.set(key, value);
  }
  keys(): readonly string[] {
    return [...this.data.keys()];
  }
  setKeysForSync(): void {
    // no-op
  }
}

function makeMemento(): FakeMemento {
  return new FakeMemento();
}

describe("QueueStore", () => {
  it("returns empty defaults when nothing is persisted", () => {
    const store = new QueueStore(makeMemento() as unknown as any);
    expect(store.read()).toEqual({ items: [], paused: false });
  });

  it("saves and reloads items + paused flag", async () => {
    const memento = makeMemento();
    const store = new QueueStore(memento as unknown as any);
    const items: QueueItem[] = [
      {
        id: "q1",
        text: "hello",
        priority: 0,
        createdAt: 1,
        status: "queued",
      },
    ];
    await store.save(items, true);
    const out = store.read();
    expect(out.items).toEqual(items);
    expect(out.paused).toBe(true);
  });

  it("clear() empties items and resets paused", async () => {
    const store = new QueueStore(makeMemento() as unknown as any);
    await store.save(
      [
        {
          id: "q1",
          text: "x",
          priority: 0,
          createdAt: 1,
          status: "queued",
        },
      ],
      true,
    );
    await store.clear();
    expect(store.read()).toEqual({ items: [], paused: false });
  });

  it("survives a malformed memento payload (non-array items)", () => {
    const memento = makeMemento();
    void memento.update("nexus.queue.items", "not-an-array");
    void memento.update("nexus.queue.paused", "truthy");
    const store = new QueueStore(memento as unknown as any);
    expect(store.read()).toEqual({ items: [], paused: true });
  });
});

describe("QueueManager onChange + hydrate", () => {
  it("fires onChange after add / remove / edit / move / sendNow / popNext / clear / setPaused", () => {
    const qm = new QueueManager();
    let calls = 0;
    qm.onChange(() => calls++);

    const a = qm.add({ text: "a", priority: 0 });
    const b = qm.add({ text: "b", priority: 0 });
    qm.edit(a.id, "a-renamed");
    qm.move(b.id, "top");
    qm.remove(a.id);
    qm.setPaused(true);
    qm.setPaused(true); // no-op
    qm.setPaused(false);
    qm.sendNow(b.id, "interrupt-current");
    qm.add({ text: "c", priority: 0 });
    qm.popNext();
    qm.clear();
    qm.clear(); // no-op when already empty

    // Each non-noop mutation fires once; setPaused(true)→true and clear-empty are no-ops.
    expect(calls).toBeGreaterThanOrEqual(10);
  });

  it("hydrate does NOT fire onChange (avoid persist ping-pong on activate)", () => {
    const qm = new QueueManager();
    let calls = 0;
    qm.onChange(() => calls++);
    qm.hydrate(
      [
        {
          id: "q1",
          text: "live",
          priority: 0,
          createdAt: 1,
          status: "queued",
        },
      ],
      true,
    );
    expect(calls).toBe(0);
    expect(qm.list()).toHaveLength(1);
    expect(qm.isPaused()).toBe(true);
  });

  it("hydrate filters out stale terminal-status items", () => {
    const qm = new QueueManager();
    qm.hydrate(
      [
        { id: "live", text: "x", priority: 0, createdAt: 1, status: "queued" },
        { id: "stale-sent", text: "y", priority: 0, createdAt: 2, status: "sent" },
        { id: "stale-cancelled", text: "z", priority: 0, createdAt: 3, status: "cancelled" },
        { id: "stale-failed", text: "w", priority: 0, createdAt: 4, status: "failed" },
      ],
      false,
    );
    const ids = qm.list().map((i) => i.id);
    expect(ids).toEqual(["live"]);
  });

  it("listener errors do not break the queue", () => {
    const qm = new QueueManager();
    qm.onChange(() => {
      throw new Error("boom");
    });
    expect(() => qm.add({ text: "x", priority: 0 })).not.toThrow();
    expect(qm.list()).toHaveLength(1);
  });
});
