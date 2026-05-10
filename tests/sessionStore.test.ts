import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/core/storage/sessionStore";
import { TaskManager } from "../src/core/agent/taskManager";
import type { TaskRecord } from "../src/shared/types";

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

function fakeTask(id: string, startedAt: number, status: TaskRecord["status"] = "completed"): TaskRecord {
  return {
    id,
    title: `task ${id}`,
    prompt: `prompt ${id}`,
    modeId: "code",
    activeSkills: [],
    providerId: "openai",
    modelId: "gpt-4o",
    status,
    toolCalls: [],
    messages: [],
    startedAt,
    endedAt: status === "completed" ? startedAt + 100 : undefined,
  };
}

describe("SessionStore", () => {
  it("returns [] when nothing is persisted", () => {
    const store = new SessionStore(new FakeMemento() as unknown as any);
    expect(store.recentTasks()).toEqual([]);
  });

  it("saves and reloads the task", async () => {
    const memento = new FakeMemento();
    const store = new SessionStore(memento as unknown as any);
    const t = fakeTask("a", 1);
    await store.saveTask(t);
    expect(store.recentTasks()).toHaveLength(1);
    expect(store.recentTasks()[0]).toMatchObject({ id: "a", title: "task a" });
  });

  it("dedups by id (newest write wins, no duplicates)", async () => {
    const store = new SessionStore(new FakeMemento() as unknown as any);
    await store.saveTask(fakeTask("a", 1));
    await store.saveTask({ ...fakeTask("a", 1), title: "renamed" });
    const list = store.recentTasks();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("renamed");
  });

  it("orders newest-first by save order (most-recently saved at index 0)", async () => {
    const store = new SessionStore(new FakeMemento() as unknown as any);
    await store.saveTask(fakeTask("a", 1));
    await store.saveTask(fakeTask("b", 2));
    await store.saveTask(fakeTask("c", 3));
    const list = store.recentTasks();
    expect(list.map((t) => t.id)).toEqual(["c", "b", "a"]);
  });

  it("truncates to the configured max", async () => {
    const store = new SessionStore(new FakeMemento() as unknown as any);
    for (let i = 0; i < 5; i++) {
      await store.saveTask(fakeTask(`t${i}`, i), 3);
    }
    const list = store.recentTasks();
    expect(list).toHaveLength(3);
    // Most-recent first
    expect(list.map((t) => t.id)).toEqual(["t4", "t3", "t2"]);
  });

  it("clear() empties the store", async () => {
    const store = new SessionStore(new FakeMemento() as unknown as any);
    await store.saveTask(fakeTask("a", 1));
    await store.clear();
    expect(store.recentTasks()).toEqual([]);
  });
});

describe("TaskManager.seed/clear", () => {
  it("seeds without firing onUpdate", () => {
    const tm = new TaskManager();
    let calls = 0;
    tm.onUpdate(() => calls++);
    tm.seed([fakeTask("a", 1), fakeTask("b", 2)]);
    expect(calls).toBe(0);
    expect(tm.list().map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("seed does not overwrite existing tasks", () => {
    const tm = new TaskManager();
    tm.seed([fakeTask("a", 1)]);
    tm.update("a", { title: "live" });
    tm.seed([fakeTask("a", 2)]); // would have title "task a"
    expect(tm.get("a")?.title).toBe("live");
  });

  it("clear() empties the manager", () => {
    const tm = new TaskManager();
    tm.seed([fakeTask("a", 1), fakeTask("b", 2)]);
    tm.clear();
    expect(tm.list()).toEqual([]);
    expect(tm.current()).toBeUndefined();
  });
});
