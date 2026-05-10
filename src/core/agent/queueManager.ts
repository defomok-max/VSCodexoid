import type { QueueItem, QueueItemStatus, QueueSendBehavior } from "../../shared/types";

/**
 * In-memory FIFO queue of pending user messages. Items can be reordered,
 * edited, or "sent now" with a behavior modifier that affects how the agent
 * runner interprets them (see `QueueSendBehavior`).
 *
 * Persistence is intentionally external — the host wires `onChange` to a
 * `QueueStore` that mirrors items + paused flag into `globalState`.
 */
export class QueueManager {
  private items: QueueItem[] = [];
  private paused = false;
  private listeners = new Set<() => void>();

  list(): QueueItem[] {
    return [...this.items];
  }

  isPaused(): boolean {
    return this.paused;
  }

  setPaused(p: boolean): void {
    if (this.paused === p) return;
    this.paused = p;
    this.fire();
  }

  /**
   * Subscribe to mutations. Called after every state change (add / remove /
   * edit / move / sendNow / popNext / clear / setPaused). `hydrate` does NOT
   * fire — it is meant to seed state from disk without ping-ponging back.
   */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Replace state from a persisted snapshot. Filters out terminal-status
   * items (sent / cancelled / failed) so a stale memento payload never
   * resurrects already-handled messages.
   */
  hydrate(items: QueueItem[], paused: boolean): void {
    const live = items.filter((i) => i && (i.status === "queued" || i.status === "next"));
    this.items = live.map((i) => ({ ...i, status: "queued" as QueueItemStatus }));
    this.paused = !!paused;
    this.refreshNext();
  }

  add(input: Omit<QueueItem, "id" | "createdAt" | "status">): QueueItem {
    const item: QueueItem = {
      ...input,
      id: makeId(),
      createdAt: Date.now(),
      status: "queued",
    };
    this.items.push(item);
    this.refreshNext();
    this.fire();
    return item;
  }

  remove(id: string): boolean {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.items.splice(i, 1);
    this.refreshNext();
    this.fire();
    return true;
  }

  edit(id: string, text: string): boolean {
    const item = this.items.find((x) => x.id === id);
    if (!item) return false;
    item.text = text;
    this.fire();
    return true;
  }

  move(id: string, direction: "up" | "down" | "top"): boolean {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return false;
    if (direction === "top") {
      const [it] = this.items.splice(i, 1);
      this.items.unshift(it);
    } else if (direction === "up") {
      if (i === 0) return false;
      [this.items[i - 1], this.items[i]] = [this.items[i], this.items[i - 1]];
    } else {
      if (i >= this.items.length - 1) return false;
      [this.items[i], this.items[i + 1]] = [this.items[i + 1], this.items[i]];
    }
    this.refreshNext();
    this.fire();
    return true;
  }

  sendNow(id: string, behavior: QueueSendBehavior): { item: QueueItem; behavior: QueueSendBehavior } | undefined {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return undefined;
    if (behavior === "high-priority-next") {
      const item = this.items[i];
      item.priority = Math.max(item.priority ?? 0, this.highestPriority() + 1);
      item.sendBehavior = behavior;
      this.refreshNext();
      this.fire();
      return { item: { ...item }, behavior };
    }
    const [item] = this.items.splice(i, 1);
    item.status = "sent";
    item.sendBehavior = behavior;
    this.refreshNext();
    this.fire();
    return { item, behavior };
  }

  /**
   * Pop the next queued item. Returns undefined when the queue is paused or
   * empty. Marks the popped item as "sent".
   */
  popNext(): QueueItem | undefined {
    if (this.paused) return undefined;
    const i = this.items.findIndex((x) => x.status === "queued" || x.status === "next");
    if (i < 0) return undefined;
    const [item] = this.items.splice(i, 1);
    item.status = "sent";
    this.refreshNext();
    this.fire();
    return item;
  }

  clear(): void {
    if (this.items.length === 0) return;
    this.items = [];
    this.fire();
  }

  private fire(): void {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch {
        // swallow listener errors so a buggy listener can't break the queue
      }
    }
  }

  /**
   * Tags the highest-priority queued item with `next` so the UI can highlight it.
   */
  private refreshNext(): void {
    let chosen = -1;
    let bestPriority = -Infinity;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.status === "sent" || it.status === "cancelled" || it.status === "failed") continue;
      const p = it.priority ?? 0;
      if (p > bestPriority) {
        bestPriority = p;
        chosen = i;
      }
    }
    for (let i = 0; i < this.items.length; i++) {
      const isSentLike = endStatus(this.items[i].status);
      if (isSentLike) continue;
      this.items[i].status = i === chosen ? "next" : "queued";
    }
  }

  private highestPriority(): number {
    return this.items.reduce((max, item) => Math.max(max, item.priority ?? 0), -Infinity);
  }
}

function endStatus(s: QueueItemStatus): boolean {
  return s === "sent" || s === "cancelled" || s === "failed";
}

function makeId(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
