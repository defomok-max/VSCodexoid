import { describe, expect, it, beforeEach } from "vitest";
import { PreferencesStore, type NexusPreferences } from "../src/core/storage/preferencesStore";

/**
 * Minimal `vscode.Memento` stand-in. Mirrors the surface the store
 * actually uses; no need to drag the real `vscode` namespace into unit
 * tests.
 */
class FakeMemento {
  private store = new Map<string, unknown>();
  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.store.has(key) ? (this.store.get(key) as T) : defaultValue) as T | undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async update(key: string, value: any): Promise<void> {
    if (value === undefined) this.store.delete(key);
    else this.store.set(key, value);
  }
  keys(): readonly string[] {
    return [...this.store.keys()];
  }
}

let memento: FakeMemento;
let store: PreferencesStore;

beforeEach(() => {
  memento = new FakeMemento();
  store = new PreferencesStore(memento as unknown as import("vscode").Memento);
});

describe("PreferencesStore", () => {
  it("returns an empty record on first read", () => {
    expect(store.read()).toEqual({});
  });

  it("persists and reads back a partial update", async () => {
    await store.update({ currentMode: "architect" });
    expect(store.read()).toEqual({ currentMode: "architect" });
    // A second store sharing the same memento sees the same value.
    const store2 = new PreferencesStore(memento as unknown as import("vscode").Memento);
    expect(store2.read()).toEqual({ currentMode: "architect" });
  });

  it("merges fields rather than replacing the record", async () => {
    await store.update({ currentMode: "code" });
    await store.update({} satisfies NexusPreferences);
    expect(store.read().currentMode).toBe("code");
  });

  it("treats `undefined` field values as removals", async () => {
    await store.update({ currentMode: "debug" });
    await store.update({ currentMode: undefined });
    expect(store.read()).toEqual({});
  });

  it("clear() wipes the entire record", async () => {
    await store.update({ currentMode: "review" });
    await store.clear();
    expect(store.read()).toEqual({});
  });

  it("falls back to {} when the persisted value is corrupt / non-object", async () => {
    // Simulate a corrupted memento entry (e.g., a previous version stored a
    // string by accident).
    await memento.update("nexus.preferences", "broken" as unknown as NexusPreferences);
    expect(store.read()).toEqual({});
  });
});
