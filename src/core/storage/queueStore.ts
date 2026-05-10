import * as vscode from "vscode";
import type { QueueItem } from "../../shared/types";

const KEY_ITEMS = "nexus.queue.items";
const KEY_PAUSED = "nexus.queue.paused";

/**
 * Persists the queue (items + paused flag) into VS Code's `globalState` so it
 * survives an extension reload. Mirrors `SessionStore`'s memento-backed shape.
 *
 * The `QueueManager` owns the in-memory state; this store is a thin disk
 * mirror and is updated from a single `onChange` listener wired in
 * `extension.ts`.
 */
export class QueueStore {
  constructor(private readonly memento: vscode.Memento) {}

  read(): { items: QueueItem[]; paused: boolean } {
    const items = this.memento.get<QueueItem[]>(KEY_ITEMS, []);
    const paused = this.memento.get<boolean>(KEY_PAUSED, false);
    return { items: Array.isArray(items) ? items : [], paused: !!paused };
  }

  async save(items: QueueItem[], paused: boolean): Promise<void> {
    await Promise.all([
      this.memento.update(KEY_ITEMS, items),
      this.memento.update(KEY_PAUSED, paused),
    ]);
  }

  async clear(): Promise<void> {
    await Promise.all([
      this.memento.update(KEY_ITEMS, []),
      this.memento.update(KEY_PAUSED, false),
    ]);
  }
}
