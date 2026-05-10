import type { QueueItem, QueueItemStatus, QueueSendBehavior } from "../../shared/types";

/**
 * In-memory FIFO queue of pending user messages. Items can be reordered,
 * edited, or "sent now" with a behavior modifier that affects how the agent
 * runner interprets them (see `QueueSendBehavior`).
 *
 * Persistence is intentionally external — the extension serializes the queue
 * to globalState whenever a mutation occurs.
 */
export class QueueManager {
  private items: QueueItem[] = [];
  private paused = false;

  list(): QueueItem[] {
    return [...this.items];
  }

  isPaused(): boolean {
    return this.paused;
  }

  setPaused(p: boolean): void {
    this.paused = p;
  }

  hydrate(items: QueueItem[], paused: boolean): void {
    this.items = [...items];
    this.paused = paused;
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
    return item;
  }

  remove(id: string): boolean {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.items.splice(i, 1);
    this.refreshNext();
    return true;
  }

  edit(id: string, text: string): boolean {
    const item = this.items.find((x) => x.id === id);
    if (!item) return false;
    item.text = text;
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
    return true;
  }

  sendNow(id: string, behavior: QueueSendBehavior): { item: QueueItem; behavior: QueueSendBehavior } | undefined {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return undefined;
    const [item] = this.items.splice(i, 1);
    item.status = "sent";
    item.sendBehavior = behavior;
    this.refreshNext();
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
    return item;
  }

  clear(): void {
    this.items = [];
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
}

function endStatus(s: QueueItemStatus): boolean {
  return s === "sent" || s === "cancelled" || s === "failed";
}

function makeId(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
